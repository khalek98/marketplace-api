import { randomUUID } from "node:crypto";

import { HeadObjectCommand, NotFound } from "@aws-sdk/client-s3";
import { Injectable, OnModuleInit } from "@nestjs/common";
import { QueryFailedError } from "typeorm";

import { ApplicationError } from "../common/errors/application-error";
import { readStorageEnv } from "../config/env.schema";
import dataSource from "../data-source";
import { FileRecord } from "../entities/file.entity";
import { Product } from "../entities/product.entity";
import { createStorageClient } from "../storage/client";
import { presignPut } from "../storage/presign";
import { extensionFor, MULTIPART_THRESHOLD_BYTES, PRESIGN_TTL_SECONDS } from "./content-types";
import { CommitBody, IntentBody, IntentRequest, ParsedIntent } from "./uploads.types";

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
    try {
      await dataSource.getRepository(FileRecord).insert({
        id,
        ownerId,
        objectKey,
        status: "pending",
        contentType: parsed.contentType,
        sizeBytes: parsed.sizeBytes === null ? null : String(parsed.sizeBytes),
        uploadId: null,
        etag: null,
        purpose: parsed.purpose,
        productId: parsed.productId,
        idempotencyKey: key,
      });
    } catch (error) {
      if (!isUniqueViolation(error)) throw error;
      const raced = await this.findByIdempotency(ownerId, key);
      if (!raced) throw error;
      return this.replay(raced, parsed);
    }

    const created = await this.requireOwn(id, ownerId);
    return { replay: false, body: await this.withUploadUrl(created) };
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
    return { replay: true, body: await this.withUploadUrl(row) };
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
    if (body.size_bytes > MULTIPART_THRESHOLD_BYTES) {
      throw new ApplicationError(
        413,
        "Multipart required",
        "Files larger than 8 MiB use a multipart upload.",
        "multipart-required",
      );
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
