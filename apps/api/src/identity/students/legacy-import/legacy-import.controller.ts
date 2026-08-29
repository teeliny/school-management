import { BadRequestException, Body, Controller, Post, UploadedFile, UseGuards, UseInterceptors } from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import { memoryStorage } from "multer";
import { JwtAuthGuard } from "../../../auth/jwt-auth.guard";
import { PoliciesGuard } from "../../../casl/policies.guard";
import { CheckPolicies } from "../../../casl/check-policies.decorator";
import { LegacyImportRequestDto } from "./dto/legacy-import.dto";
import { LegacyImportService } from "./legacy-import.service";

const MAX_CSV_FILE_SIZE_BYTES = 10 * 1024 * 1024;

// Backend-only by design (PRD discussion) — no frontend UI, Super-Admin/
// Registrar call this directly (e.g. via Postman) with the CSV template.
// Same `ability.can("manage", "StudentProfile")` gate the normal student
// endpoints use, so no new CASL rule was needed just for this route.
@Controller("students/legacy-import")
@UseGuards(JwtAuthGuard, PoliciesGuard)
export class LegacyImportController {
  constructor(private readonly service: LegacyImportService) {}

  @Post()
  @CheckPolicies((ability) => ability.can("manage", "StudentProfile"))
  @UseInterceptors(
    FileInterceptor("file", {
      storage: memoryStorage(),
      limits: { fileSize: MAX_CSV_FILE_SIZE_BYTES },
      fileFilter: (_req, file, callback) => {
        if (!file.originalname.toLowerCase().endsWith(".csv") && file.mimetype !== "text/csv") {
          callback(new BadRequestException("File must be a .csv"), false);
          return;
        }
        callback(null, true);
      },
    }),
  )
  import(@UploadedFile() file: Express.Multer.File, @Body() dto: LegacyImportRequestDto) {
    if (!file) {
      throw new BadRequestException("CSV file is required");
    }
    return this.service.importCsv(file.buffer, dto.termId);
  }
}
