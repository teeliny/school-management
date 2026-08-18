// Duplicated from apps/worker/src/storage/storage-adapter.ts — same
// "duplicate per app, don't cross-import" precedent as PrismaService/
// parseCorsOrigins(). This is apps/api's first use of StorageAdapter
// (Phase 5 Slice 2c — Bursar-uploaded proof-of-payment files).
export const STORAGE_ADAPTER = Symbol("STORAGE_ADAPTER");

export interface StorageAdapter {
  put(key: string, body: Buffer, contentType: string): Promise<void>;
  getSignedUrl(key: string, expiresInSeconds: number): Promise<string>;
  delete(key: string): Promise<void>;
}
