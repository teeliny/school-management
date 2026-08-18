import { Body, Controller, Delete, Get, Injectable, Param, Patch, Post, UseGuards } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../../prisma/prisma.service";
import { EnvelopeEncryptionService } from "../../common/crypto/envelope-encryption.service";
import { JwtAuthGuard } from "../../auth/jwt-auth.guard";
import { PoliciesGuard } from "../../casl/policies.guard";
import { CheckPolicies } from "../../casl/check-policies.decorator";
import { Audited } from "../../audit/audited.decorator";
import { CreatePaymentGatewayConfigDto, UpdatePaymentGatewayConfigDto } from "./dto/payment-gateway-config.dto";

// PRD FR7.7: apiKey/secretKey are "never exposed to the frontend or logs"
// — every method below explicitly selects every field EXCEPT those two,
// rather than fetching-then-stripping, so the decrypted (or even encrypted)
// values never even leave the database round-trip into a response body.
const SAFE_SELECT = {
  id: true,
  provider: true,
  contractCode: true,
  reservedAccountEnabled: true,
  environment: true,
  isActive: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.PaymentGatewayConfigSelect;

@Injectable()
export class PaymentGatewayConfigService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly envelope: EnvelopeEncryptionService,
  ) {}

  create(dto: CreatePaymentGatewayConfigDto) {
    return this.prisma.paymentGatewayConfig.create({
      data: {
        ...dto,
        apiKey: this.envelope.encrypt(dto.apiKey),
        secretKey: this.envelope.encrypt(dto.secretKey),
      },
      select: SAFE_SELECT,
    });
  }

  findAll() {
    return this.prisma.paymentGatewayConfig.findMany({ select: SAFE_SELECT, orderBy: { provider: "asc" } });
  }

  findOne(id: string) {
    return this.prisma.paymentGatewayConfig.findUniqueOrThrow({ where: { id }, select: SAFE_SELECT });
  }

  update(id: string, dto: UpdatePaymentGatewayConfigDto) {
    return this.prisma.paymentGatewayConfig.update({
      where: { id },
      data: {
        ...dto,
        apiKey: dto.apiKey ? this.envelope.encrypt(dto.apiKey) : undefined,
        secretKey: dto.secretKey ? this.envelope.encrypt(dto.secretKey) : undefined,
      },
      select: SAFE_SELECT,
    });
  }

  remove(id: string) {
    return this.prisma.paymentGatewayConfig.delete({ where: { id }, select: SAFE_SELECT });
  }
}

@Controller("payment-gateway-configs")
@UseGuards(JwtAuthGuard, PoliciesGuard)
export class PaymentGatewayConfigController {
  constructor(private readonly service: PaymentGatewayConfigService) {}

  // No `model` arg on any of the three writes below — AuditInterceptor's
  // before-fetch would pull the raw row including envelope-encrypted
  // apiKey/secretKey, and that ciphertext has no business living in a
  // second table. `after` is always whatever this controller returns,
  // which is already SAFE_SELECT-projected (secrets excluded) — same
  // "never exposed to logs" invariant preserved in the audit trail too.
  @Post()
  @CheckPolicies((ability) => ability.can("manage", "PaymentGatewayConfig"))
  @Audited("PaymentGatewayConfig")
  create(@Body() dto: CreatePaymentGatewayConfigDto) {
    return this.service.create(dto);
  }

  @Get()
  @CheckPolicies((ability) => ability.can("manage", "PaymentGatewayConfig"))
  findAll() {
    return this.service.findAll();
  }

  @Get(":id")
  @CheckPolicies((ability) => ability.can("manage", "PaymentGatewayConfig"))
  findOne(@Param("id") id: string) {
    return this.service.findOne(id);
  }

  @Patch(":id")
  @CheckPolicies((ability) => ability.can("manage", "PaymentGatewayConfig"))
  @Audited("PaymentGatewayConfig")
  update(@Param("id") id: string, @Body() dto: UpdatePaymentGatewayConfigDto) {
    return this.service.update(id, dto);
  }

  @Delete(":id")
  @CheckPolicies((ability) => ability.can("manage", "PaymentGatewayConfig"))
  @Audited("PaymentGatewayConfig")
  remove(@Param("id") id: string) {
    return this.service.remove(id);
  }
}
