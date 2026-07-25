import { Global, Module } from "@nestjs/common";
import { EnvelopeEncryptionService } from "./crypto/envelope-encryption.service";

@Global()
@Module({
  providers: [EnvelopeEncryptionService],
  exports: [EnvelopeEncryptionService],
})
export class CommonModule {}
