import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { DeleteObjectCommand, GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import type { StorageAdapter } from "./storage-adapter";

/**
 * Supabase Storage's default concrete implementation (S3-compatible API,
 * ARCHITECTURE.md §5) — talks to STORAGE_ENDPOINT/BUCKET/ACCESS_KEY/
 * SECRET_KEY (.env.example) via the standard AWS S3 SDK rather than a
 * Supabase-specific client, so swapping to real AWS S3 later is a config
 * change, not a rewrite.
 */
@Injectable()
export class S3StorageAdapter implements StorageAdapter {
  private readonly client: S3Client;
  private readonly bucket: string;

  constructor(config: ConfigService) {
    this.bucket = config.getOrThrow<string>("STORAGE_BUCKET");
    this.client = new S3Client({
      endpoint: config.getOrThrow<string>("STORAGE_ENDPOINT"),
      region: "auto",
      forcePathStyle: true,
      credentials: {
        accessKeyId: config.getOrThrow<string>("STORAGE_ACCESS_KEY"),
        secretAccessKey: config.getOrThrow<string>("STORAGE_SECRET_KEY"),
      },
    });
  }

  async put(key: string, body: Buffer, contentType: string): Promise<void> {
    await this.client.send(
      new PutObjectCommand({ Bucket: this.bucket, Key: key, Body: body, ContentType: contentType }),
    );
  }

  getSignedUrl(key: string, expiresInSeconds: number): Promise<string> {
    return getSignedUrl(this.client, new GetObjectCommand({ Bucket: this.bucket, Key: key }), {
      expiresIn: expiresInSeconds,
    });
  }

  async delete(key: string): Promise<void> {
    await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
  }
}
