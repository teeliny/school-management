import { Module } from "@nestjs/common";
import { IdentityModule } from "../../identity.module";
import { FeesModule } from "../../../fees/fees.module";
import { LegacyImportController } from "./legacy-import.controller";
import { LegacyImportService } from "./legacy-import.service";

// Split out from IdentityModule (rather than added directly to it) because
// it needs FeesModule's InvoiceService for the opening-balance invoice —
// IdentityModule itself has no fee/finance dependency otherwise, and this
// keeps that cross-domain wiring contained to the one feature that needs it.
@Module({
  imports: [IdentityModule, FeesModule],
  controllers: [LegacyImportController],
  providers: [LegacyImportService],
})
export class LegacyImportModule {}
