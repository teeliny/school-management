export const STORAGE_ADAPTER = Symbol("STORAGE_ADAPTER");

/**
 * ARCHITECTURE.md §5: file storage behind a small interface so nothing
 * outside this module knows the concrete provider (Supabase Storage today,
 * S3-compatible) — swapping providers later means a new adapter, not
 * touching every place a report card gets uploaded.
 */
export interface StorageAdapter {
  put(key: string, body: Buffer, contentType: string): Promise<void>;
  getSignedUrl(key: string, expiresInSeconds: number): Promise<string>;
  delete(key: string): Promise<void>;
}
