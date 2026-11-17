/** Avatar form is filled now, not next week. SigV4 allows 7 days; this does not. */
export const PRESIGN_TTL_SECONDS = 180;

/** A private read is a redirect onto a fresh link, not a week-long URL in a message. */
export const READ_PRESIGN_SECONDS = 60;

/** Photos at or under this size are one PutObject. Larger files are multipart. */
export const MULTIPART_THRESHOLD_BYTES = 8 * 1024 * 1024;

/** Hard ceiling for intent.size_bytes. Marketplace photos do not need more. */
export const MAX_UPLOAD_BYTES = 100 * 1024 * 1024;

/** Every part except the last must be at least this big, or Complete returns EntityTooSmall. */
export const MIN_PART_BYTES = 5 * 1024 * 1024;

/** S3 allows at most 10 000 parts, so the part grows with the file. */
export function partSizeFor(fileSize: number): number {
  return Math.max(MIN_PART_BYTES, Math.ceil(fileSize / 10_000));
}

export function partCountFor(fileSize: number): number {
  return Math.ceil(fileSize / partSizeFor(fileSize));
}

const EXTENSION_BY_TYPE = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
} as const;

export type AllowedContentType = keyof typeof EXTENSION_BY_TYPE;

export function extensionFor(contentType: string): string | undefined {
  return EXTENSION_BY_TYPE[contentType as AllowedContentType];
}
