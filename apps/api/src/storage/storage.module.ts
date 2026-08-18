import { Global, Module } from "@nestjs/common";
import { S3StorageAdapter } from "./s3-storage-adapter";
import { STORAGE_ADAPTER } from "./storage-adapter";

@Global()
@Module({
  providers: [{ provide: STORAGE_ADAPTER, useClass: S3StorageAdapter }],
  exports: [STORAGE_ADAPTER],
})
export class StorageModule {}
