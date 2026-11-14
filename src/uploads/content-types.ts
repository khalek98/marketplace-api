/** Avatar form is filled now, not next week. SigV4 allows 7 days; this does not. */
export const PRESIGN_TTL_SECONDS = 180;

/** Photos at or under this size are one PutObject. Larger files wait for multipart. */
export const MULTIPART_THRESHOLD_BYTES = 8 * 1024 * 1024;

const EXTENSION_BY_TYPE = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
} as const;

export type AllowedContentType = keyof typeof EXTENSION_BY_TYPE;

export function extensionFor(contentType: string): string | undefined {
  return EXTENSION_BY_TYPE[contentType as AllowedContentType];
}
