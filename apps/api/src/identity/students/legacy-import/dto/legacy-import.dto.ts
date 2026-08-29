import { IsUUID } from "class-validator";

// Multipart body field alongside the CSV file (see SubmitManualBankTransferDto
// for the same @Body()-alongside-@UploadedFile() shape) — the term every
// migrated student's opening-balance invoice gets billed to. Must already
// exist: Invoice.termId is a hard-required FK and nothing auto-seeds a term.
export class LegacyImportRequestDto {
  @IsUUID()
  termId!: string;
}
