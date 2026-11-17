import { FilePurpose, FileStatus } from "../entities/file.entity";

export type IntentRequest = {
  content_type?: unknown;
  purpose?: unknown;
  product_id?: unknown;
  size_bytes?: unknown;
  /** Accepted and discarded. The object key never contains it. */
  filename?: unknown;
};

export type IntentBody = {
  id: string;
  object_key: string;
  status: FileStatus;
  expires_in?: number;
  upload?: {
    method: "PUT";
    url: string;
    headers: { "Content-Type": string };
  };
  upload_id?: string;
  part_size?: number;
  parts?: Array<{ part_number: number; url: string }>;
};

export type PartPlan = {
  part_size: number;
  present: Array<{ part_number: number; etag: string }>;
  missing: Array<{ part_number: number; url: string }>;
};

export type CommitBody = {
  id: string;
  object_key: string;
  status: "completed";
  size_bytes: number;
  etag: string;
};

export type ParsedIntent = {
  contentType: string;
  extension: string;
  purpose: FilePurpose;
  productId: string | null;
  sizeBytes: number;
};
