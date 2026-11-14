import { randomUUID } from "node:crypto";

import {
  AbortMultipartUploadCommand,
  CompleteMultipartUploadCommand,
  CreateMultipartUploadCommand,
  HeadObjectCommand,
  ListPartsCommand,
  NotFound,
} from "@aws-sdk/client-s3";
import { Injectable, OnModuleInit } from "@nestjs/common";
import { QueryFailedError } from "typeorm";

import { ApplicationError } from "../common/errors/application-error";
import { readStorageEnv } from "../config/env.schema";
import dataSource from "../data-source";
import { FileRecord } from "../entities/file.entity";
import { Product } from "../entities/product.entity";
import { createStorageClient } from "../storage/client";
import { presignPut, presignUploadPart } from "../storage/presign";
import {
  extensionFor,
  MULTIPART_THRESHOLD_BYTES,
  partCountFor,
  partSizeFor,
  PRESIGN_TTL_SECONDS,
} from "./content-types";
import { CommitBody, IntentBody, IntentRequest, ParsedIntent, PartPlan } from "./uploads.types";

@Injectable()
export class UploadsService implements OnModuleInit {
  async onModuleInit(): Promise<void> {
    if (!dataSource.isInitialized) await dataSource.initialize();
  }

  async intent(
    ownerId: string,
    idempotencyKey: string | undefined,
    body: IntentRequest,
  ): Promise<{ replay: boolean; body: IntentBody }> {
    const key = requireIdempotencyKey(idempotencyKey);
    const parsed = parseIntent(body);
    const existing = await this.findByIdempotency(ownerId, key);
    if (existing) return this.replay(existing, parsed);

    if (parsed.productId) await this.assertOwnProduct(ownerId, parsed.productId);

    const id = randomUUID();
    const objectKey = `uploads/${ownerId}/${id}.${parsed.extension}`;
    const uploadId = await this.beginMultipart(objectKey, parsed);
    try {
      await dataSource.getRepository(FileRecord).insert({
        id,
        ownerId,
        objectKey,
        status: "pending",
        contentType: parsed.contentType,
        sizeBytes: parsed.sizeBytes === null ? null : String(parsed.sizeBytes),
        uploadId,
        etag: null,
        purpose: parsed.purpose,
        productId: parsed.productId,
        idempotencyKey: key,
      });
    } catch (error) {
      if (uploadId) await this.abortMultipart(objectKey, uploadId);
      if (!isUniqueViolation(error)) throw error;
      const raced = await this.findByIdempotency(ownerId, key);
      if (!raced) throw error;
      return this.replay(raced, parsed);
    }

    const created = await this.requireOwn(id, ownerId);
    return { replay: false, body: await this.describe(created) };
  }

  async commit(ownerId: string, id: string): Promise<CommitBody> {
    const row = await dataSource.getRepository(FileRecord).findOne({ where: { id } });
    if (!row) {
      throw new ApplicationError(404, "File not found", `File '${id}' does not exist.`, "file-not-found");
    }
    if (row.ownerId !== ownerId) {
      throw new ApplicationError(403, "Not the file owner", "This file belongs to another user.", "not-file-owner");
    }

    const head = await this.head(row.objectKey);
    if (!head) {
      throw new ApplicationError(
        409,
        "Object missing",
        "The object is not in storage, so the upload cannot be committed.",
        "object-missing",
      );
    }
    if (row.sizeBytes !== null && Number(row.sizeBytes) !== head.size) {
      throw new ApplicationError(
        409,
        "Size mismatch",
        "The stored object size does not match the size declared at intent.",
        "size-mismatch",
      );
    }

    row.status = "completed";
    row.sizeBytes = String(head.size);
    row.etag = head.etag;
    await dataSource.getRepository(FileRecord).save(row);
    return {
      id: row.id,
      object_key: row.objectKey,
      status: "completed",
      size_bytes: head.size,
      etag: head.etag,
    };
  }

  async missingParts(ownerId: string, id: string): Promise<PartPlan> {
    const row = await this.pendingMultipart(ownerId, id);
    const size = Number(row.sizeBytes);
    const partSize = partSizeFor(size);
    const expected = partCountFor(size);
    const present = await this.storedParts(row);
    const have = new Set(present.map((part) => part.part_number));
    const missing: PartPlan["missing"] = [];
    for (let partNumber = 1; partNumber <= expected; partNumber += 1) {
      if (have.has(partNumber)) continue;
      missing.push({
        part_number: partNumber,
        url: await presignUploadPart(row.objectKey, row.uploadId as string, partNumber, PRESIGN_TTL_SECONDS),
      });
    }
    return { part_size: partSize, present, missing };
  }

  async completeMultipart(ownerId: string, id: string): Promise<CommitBody> {
    const row = await this.pendingMultipart(ownerId, id);
    const expected = partCountFor(Number(row.sizeBytes));
    const present = await this.storedParts(row);
    if (present.length !== expected || present.some((part, index) => part.part_number !== index + 1)) {
      throw new ApplicationError(
        409,
        "Parts missing",
        "Complete waits until every part is stored. Upload the missing ones first.",
        "parts-missing",
      );
    }

    const bucket = readStorageEnv().STORAGE_BUCKET;
    await createStorageClient().send(
      new CompleteMultipartUploadCommand({
        Bucket: bucket,
        Key: row.objectKey,
        UploadId: row.uploadId as string,
        MultipartUpload: {
          Parts: present.map((part) => ({ PartNumber: part.part_number, ETag: part.etag })),
        },
      }),
    );

    const head = await this.head(row.objectKey);
    if (!head || head.size !== Number(row.sizeBytes)) {
      throw new ApplicationError(
        409,
        "Size mismatch",
        "The completed object size does not match the size declared at intent.",
        "size-mismatch",
      );
    }

    row.status = "completed";
    row.sizeBytes = String(head.size);
    row.etag = head.etag;
    await dataSource.getRepository(FileRecord).save(row);
    return {
      id: row.id,
      object_key: row.objectKey,
      status: "completed",
      size_bytes: head.size,
      etag: head.etag,
    };
  }

  private async replay(row: FileRecord, parsed: ParsedIntent): Promise<{ replay: boolean; body: IntentBody }> {
    if (!sameIntent(row, parsed)) {
      throw new ApplicationError(
        409,
        "Idempotency key reused",
        "This Idempotency-Key was already used for a different upload.",
        "idempotency-key-reused",
      );
    }
    if (row.status === "completed") {
      return {
        replay: true,
        body: { id: row.id, object_key: row.objectKey, status: row.status },
      };
    }
    return { replay: true, body: await this.describe(row) };
  }

  private async describe(row: FileRecord): Promise<IntentBody> {
    if (row.status === "completed") {
      return { id: row.id, object_key: row.objectKey, status: row.status };
    }
    if (row.uploadId && row.sizeBytes !== null) return this.withPartUrls(row);
    return this.withUploadUrl(row);
  }

  private async withPartUrls(row: FileRecord): Promise<IntentBody> {
    const size = Number(row.sizeBytes);
    const partSize = partSizeFor(size);
    const count = partCountFor(size);
    const parts: Array<{ part_number: number; url: string }> = [];
    for (let partNumber = 1; partNumber <= count; partNumber += 1) {
      parts.push({
        part_number: partNumber,
        url: await presignUploadPart(row.objectKey, row.uploadId as string, partNumber, PRESIGN_TTL_SECONDS),
      });
    }
    return {
      id: row.id,
      object_key: row.objectKey,
      status: row.status,
      expires_in: PRESIGN_TTL_SECONDS,
      upload_id: row.uploadId as string,
      part_size: partSize,
      parts,
    };
  }

  private async withUploadUrl(row: FileRecord): Promise<IntentBody> {
    const url = await presignPut(row.objectKey, row.contentType, PRESIGN_TTL_SECONDS);
    return {
      id: row.id,
      object_key: row.objectKey,
      status: row.status,
      expires_in: PRESIGN_TTL_SECONDS,
      upload: {
        method: "PUT",
        url,
        headers: { "Content-Type": row.contentType },
      },
    };
  }

  private async head(objectKey: string): Promise<{ size: number; etag: string } | undefined> {
    const client = createStorageClient();
    try {
      const result = await client.send(
        new HeadObjectCommand({ Bucket: readStorageEnv().STORAGE_BUCKET, Key: objectKey }),
      );
      return { size: result.ContentLength ?? 0, etag: result.ETag ?? "" };
    } catch (error) {
      if (isMissingObject(error)) return undefined;
      throw error;
    }
  }

  private async findByIdempotency(ownerId: string, idempotencyKey: string): Promise<FileRecord | null> {
    return dataSource.getRepository(FileRecord).findOne({ where: { ownerId, idempotencyKey } });
  }

  private async requireOwn(id: string, ownerId: string): Promise<FileRecord> {
    const row = await dataSource.getRepository(FileRecord).findOne({ where: { id, ownerId } });
    if (!row) {
      throw new ApplicationError(404, "File not found", `File '${id}' does not exist.`, "file-not-found");
    }
    return row;
  }

  private async assertOwnProduct(ownerId: string, productId: string): Promise<void> {
    const product = await dataSource.getRepository(Product).findOne({
      where: { id: productId },
      relations: { seller: true },
    });
    if (!product) {
      throw new ApplicationError(
        404,
        "Product not found",
        `Product '${productId}' does not exist.`,
        "product-not-found",
      );
    }
    if (product.seller.id !== ownerId) {
      throw new ApplicationError(
        403,
        "Not the product seller",
        "Only the seller can attach a photo to this product.",
        "not-product-seller",
      );
    }
  }

  private async beginMultipart(objectKey: string, parsed: ParsedIntent): Promise<string | null> {
    if (parsed.sizeBytes === null || parsed.sizeBytes <= MULTIPART_THRESHOLD_BYTES) return null;
    const created = await createStorageClient().send(
      new CreateMultipartUploadCommand({
        Bucket: readStorageEnv().STORAGE_BUCKET,
        Key: objectKey,
        ContentType: parsed.contentType,
      }),
    );
    if (!created.UploadId) {
      throw new ApplicationError(
        502,
        "Upload was not started",
        "Storage did not return an upload id.",
        "upload-not-started",
      );
    }
    return created.UploadId;
  }

  private async abortMultipart(objectKey: string, uploadId: string): Promise<void> {
    await createStorageClient()
      .send(
        new AbortMultipartUploadCommand({
          Bucket: readStorageEnv().STORAGE_BUCKET,
          Key: objectKey,
          UploadId: uploadId,
        }),
      )
      .catch(() => undefined);
  }

  private async pendingMultipart(ownerId: string, id: string): Promise<FileRecord> {
    const row = await dataSource.getRepository(FileRecord).findOne({ where: { id } });
    if (!row) {
      throw new ApplicationError(404, "File not found", `File '${id}' does not exist.`, "file-not-found");
    }
    if (row.ownerId !== ownerId) {
      throw new ApplicationError(403, "Not the file owner", "This file belongs to another user.", "not-file-owner");
    }
    if (!row.uploadId || row.sizeBytes === null) {
      throw new ApplicationError(
        409,
        "Not a multipart upload",
        "This file was started as a single PUT.",
        "not-multipart",
      );
    }
    if (row.status === "completed") {
      throw new ApplicationError(
        409,
        "Already completed",
        "This multipart upload is already complete.",
        "already-completed",
      );
    }
    return row;
  }

  private async storedParts(row: FileRecord): Promise<Array<{ part_number: number; etag: string }>> {
    const client = createStorageClient();
    const bucket = readStorageEnv().STORAGE_BUCKET;
    const parts: Array<{ part_number: number; etag: string }> = [];
    let marker: string | undefined;
    do {
      const page = await client.send(
        new ListPartsCommand({
          Bucket: bucket,
          Key: row.objectKey,
          UploadId: row.uploadId as string,
          PartNumberMarker: marker,
        }),
      );
      for (const part of page.Parts ?? []) {
        if (part.PartNumber && part.ETag) parts.push({ part_number: part.PartNumber, etag: part.ETag });
      }
      marker = page.IsTruncated ? page.NextPartNumberMarker : undefined;
    } while (marker);
    return parts.sort((left, right) => left.part_number - right.part_number);
  }
}

function requireIdempotencyKey(value: string | undefined): string {
  const key = value?.trim() ?? "";
  if (!key || key.length > 255) {
    throw new ApplicationError(
      400,
      "Missing Idempotency-Key",
      "Header Idempotency-Key is required and must be at most 255 characters.",
      "missing-idempotency-key",
    );
  }
  return key;
}

function parseIntent(body: IntentRequest): ParsedIntent {
  const contentType = typeof body.content_type === "string" ? body.content_type : "";
  const extension = extensionFor(contentType);
  if (!extension) {
    throw new ApplicationError(
      415,
      "Unsupported media type",
      "content_type must be image/jpeg, image/png, or image/webp.",
      "unsupported-media-type",
    );
  }

  if (body.purpose !== "avatar" && body.purpose !== "product_photo") {
    throw new ApplicationError(400, "Invalid purpose", "purpose must be avatar or product_photo.", "invalid-purpose");
  }

  const productId = body.product_id == null || body.product_id === "" ? null : body.product_id;
  if (productId !== null && typeof productId !== "string") {
    throw new ApplicationError(400, "Invalid product", "product_id must be a string.", "invalid-product");
  }
  if (body.purpose === "avatar" && productId) {
    throw new ApplicationError(400, "Invalid purpose", "An avatar cannot reference a product.", "invalid-purpose");
  }
  if (body.purpose === "product_photo" && !productId) {
    throw new ApplicationError(
      400,
      "Missing product",
      "product_id is required when purpose is product_photo.",
      "missing-product",
    );
  }

  let sizeBytes: number | null = null;
  if (body.size_bytes !== undefined && body.size_bytes !== null) {
    if (typeof body.size_bytes !== "number" || !Number.isInteger(body.size_bytes) || body.size_bytes < 0) {
      throw new ApplicationError(400, "Invalid size", "size_bytes must be a non-negative integer.", "invalid-size");
    }
    sizeBytes = body.size_bytes;
  }

  return { contentType, extension, purpose: body.purpose, productId, sizeBytes };
}

function sameIntent(row: FileRecord, parsed: ParsedIntent): boolean {
  const storedSize = row.sizeBytes === null ? null : Number(row.sizeBytes);
  return (
    row.contentType === parsed.contentType &&
    row.purpose === parsed.purpose &&
    (row.productId ?? null) === parsed.productId &&
    storedSize === parsed.sizeBytes
  );
}

function isUniqueViolation(error: unknown): boolean {
  return error instanceof QueryFailedError && (error.driverError as { code?: string }).code === "23505";
}

function isMissingObject(error: unknown): boolean {
  if (error instanceof NotFound) return true;
  const name = error instanceof Error ? error.name : "";
  return name === "NotFound" || name === "NoSuchKey";
}
