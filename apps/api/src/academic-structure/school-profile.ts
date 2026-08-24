import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Inject,
  Injectable,
  NotFoundException,
  Patch,
  Post,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import { memoryStorage } from "multer";
import { PrismaService } from "../prisma/prisma.service";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { PoliciesGuard } from "../casl/policies.guard";
import { CheckPolicies } from "../casl/check-policies.decorator";
import { STORAGE_ADAPTER, type StorageAdapter } from "../storage/storage-adapter";
import { UpdateSchoolProfileDto } from "./dto/school-profile.dto";

// Same "store the freshly-signed URL, not the key" convention as
// StudentService.uploadPhoto's User.avatarUrl — see that method's comment
// for the tradeoff (the URL goes stale after this TTL and needs
// re-uploading to refresh, since StorageAdapter only exposes signed URLs).
const SIGNED_URL_TTL_SECONDS = 7 * 24 * 60 * 60;
const MAX_LOGO_FILE_SIZE_BYTES = 5 * 1024 * 1024;
const ALLOWED_LOGO_MIME_TYPES = ["image/jpeg", "image/png", "image/webp"];

@Injectable()
export class SchoolProfileService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(STORAGE_ADAPTER) private readonly storage: StorageAdapter,
  ) {}

  async get() {
    const profile = await this.prisma.schoolProfile.findFirst();
    if (!profile) throw new NotFoundException("School has not been set up yet — run `pnpm setup:school`");
    return profile;
  }

  async update(dto: UpdateSchoolProfileDto) {
    const profile = await this.get();
    return this.prisma.schoolProfile.update({ where: { id: profile.id }, data: dto });
  }

  async uploadLogo(file: Express.Multer.File) {
    const profile = await this.get();

    const key = `school-logo/${Date.now()}-${file.originalname}`;
    await this.storage.put(key, file.buffer, file.mimetype);
    const logoUrl = await this.storage.getSignedUrl(key, SIGNED_URL_TTL_SECONDS);

    await this.prisma.schoolProfile.update({ where: { id: profile.id }, data: { logoUrl } });
    return { logoUrl };
  }
}

@Controller("school-profile")
@UseGuards(JwtAuthGuard, PoliciesGuard)
export class SchoolProfileController {
  constructor(private readonly service: SchoolProfileService) {}

  @Get()
  get() {
    return this.service.get();
  }

  @Patch()
  @CheckPolicies((ability) => ability.can("manage", "SchoolProfile"))
  update(@Body() dto: UpdateSchoolProfileDto) {
    return this.service.update(dto);
  }

  @Post("logo")
  @CheckPolicies((ability) => ability.can("manage", "SchoolProfile"))
  @UseInterceptors(
    FileInterceptor("file", {
      storage: memoryStorage(),
      limits: { fileSize: MAX_LOGO_FILE_SIZE_BYTES },
      fileFilter: (_req, file, callback) => {
        if (!ALLOWED_LOGO_MIME_TYPES.includes(file.mimetype)) {
          callback(new BadRequestException("Logo must be a JPEG, PNG, or WebP image"), false);
          return;
        }
        callback(null, true);
      },
    }),
  )
  uploadLogo(@UploadedFile() file: Express.Multer.File) {
    if (!file) {
      throw new BadRequestException("Logo file is required");
    }
    return this.service.uploadLogo(file);
  }
}
