import { randomBytes } from "node:crypto";
import { BadRequestException, Injectable, Logger } from "@nestjs/common";
import { parse } from "csv-parse/sync";
import { Gender, GuardianRelationship, Role } from "@prisma/client";
import { PrismaService } from "../../../prisma/prisma.service";
import { UserService } from "../../users/user.service";
import { InvitationService } from "../../invitations/invitation.service";
import { StudentService } from "../student";
import { InvoiceService } from "../../../fees/invoice";
import type { CreateStudentDto } from "../dto/create-student.dto";

export interface LegacyImportFailure {
  row: number;
  reason: string;
  data: Record<string, string>;
}

export interface LegacyImportReport {
  totalRows: number;
  studentsCreated: number;
  parentsCreated: number;
  parentsReused: number;
  openingBalancesCreated: number;
  failures: LegacyImportFailure[];
}

const REQUIRED_COLUMNS = [
  "studentFirstName",
  "studentLastName",
  "classLevel",
  "classArm",
  "admissionYear",
  "parentFirstName",
  "parentLastName",
  "parentEmail",
  "relationship",
] as const;

function requiredField(data: Record<string, string>, key: string): string {
  const value = data[key]?.trim();
  if (!value) throw new Error(`Missing required column "${key}"`);
  return value;
}

/**
 * One-time pre-launch migration of existing students + their parents/
 * guardians from a CSV, plus each student's outstanding legacy fee balance
 * as a real Invoice (see InvoiceService.createLegacyOpeningBalance). Never
 * emails anyone — many parents have no reliable email on file yet; a
 * Super-Admin/Registrar later confirms/corrects each guardian's real email
 * exactly once from the student details page
 * (ParentProfileController.updateEmail), which is what actually sends the
 * parent a password-reset email.
 *
 * Each row is processed independently (own try/catch, no shared
 * transaction) — a bad row anywhere in a 500-row file must never roll back
 * the students already successfully imported ahead of it. Failures are
 * reported with the row's full original data so a corrected retry CSV can
 * be rebuilt directly from the JSON response.
 */
@Injectable()
export class LegacyImportService {
  private readonly logger = new Logger(LegacyImportService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly studentService: StudentService,
    private readonly invitationService: InvitationService,
    private readonly invoiceService: InvoiceService,
  ) {}

  async importCsv(buffer: Buffer, termId: string): Promise<LegacyImportReport> {
    await this.prisma.term.findUniqueOrThrow({ where: { id: termId } });

    let records: Record<string, string>[];
    try {
      records = parse(buffer, { columns: true, skip_empty_lines: true, trim: true });
    } catch (error) {
      throw new BadRequestException(`Could not parse CSV: ${error instanceof Error ? error.message : String(error)}`);
    }
    if (records.length === 0) {
      throw new BadRequestException("CSV has no data rows");
    }
    const firstRecord = records[0] as Record<string, string>;
    const missingColumns = REQUIRED_COLUMNS.filter((col) => !(col in firstRecord));
    if (missingColumns.length > 0) {
      throw new BadRequestException(`CSV is missing required column(s): ${missingColumns.join(", ")}`);
    }

    let studentsCreated = 0;
    let parentsCreated = 0;
    let parentsReused = 0;
    let openingBalancesCreated = 0;
    const failures: LegacyImportFailure[] = [];
    // Resolved across the whole run (not per-row) — a later row whose
    // parentEmail matches an earlier row's reuses that same parent, which
    // is how siblings end up under one account.
    const resolvedParentIdsByEmail = new Map<string, string>();

    for (const [i, data] of records.entries()) {
      const rowNumber = i + 2; // +1 for 0-index, +1 for the header row
      try {
        const result = await this.importRow(data, termId, resolvedParentIdsByEmail);
        studentsCreated++;
        if (result.parentCreated) parentsCreated++;
        else parentsReused++;
        if (result.openingBalanceCreated) openingBalancesCreated++;
      } catch (error) {
        const reason = error instanceof Error ? error.message : "Unknown error";
        this.logger.warn(`Row ${rowNumber} failed: ${reason}`);
        failures.push({ row: rowNumber, reason, data });
      }
    }

    return { totalRows: records.length, studentsCreated, parentsCreated, parentsReused, openingBalancesCreated, failures };
  }

  private async importRow(
    data: Record<string, string>,
    termId: string,
    resolvedParentIdsByEmail: Map<string, string>,
  ): Promise<{ parentCreated: boolean; openingBalanceCreated: boolean }> {
    const studentFirstName = requiredField(data, "studentFirstName");
    const studentLastName = requiredField(data, "studentLastName");
    const studentMiddleName = data.studentMiddleName?.trim() || undefined;
    const classLevelName = requiredField(data, "classLevel");
    const classArmName = requiredField(data, "classArm");
    const admissionYearRaw = requiredField(data, "admissionYear");
    const parentFirstName = requiredField(data, "parentFirstName");
    const parentLastName = requiredField(data, "parentLastName");
    const parentEmailRaw = requiredField(data, "parentEmail");
    const relationshipRaw = requiredField(data, "relationship");
    const parentPhone = data.parentPhone?.trim() || undefined;
    const parentAddress = data.parentAddress?.trim() || undefined;
    const outstandingRaw = data.outstanding?.trim() || "0";

    const admissionYear = Number(admissionYearRaw);
    if (!Number.isInteger(admissionYear) || admissionYear < 1900 || admissionYear > 2100) {
      throw new Error(`Invalid admissionYear "${admissionYearRaw}"`);
    }

    const relationship = relationshipRaw.toUpperCase() as GuardianRelationship;
    if (!Object.values(GuardianRelationship).includes(relationship)) {
      throw new Error(`Invalid relationship "${relationshipRaw}" — expected one of ${Object.values(GuardianRelationship).join(", ")}`);
    }

    const genderRaw = data.gender?.trim().toUpperCase();
    const gender = genderRaw && Object.values(Gender).includes(genderRaw as Gender) ? (genderRaw as Gender) : undefined;

    const outstanding = Number(outstandingRaw);
    if (Number.isNaN(outstanding) || outstanding < 0) {
      throw new Error(`Invalid outstanding "${outstandingRaw}"`);
    }

    const classArm = await this.prisma.classArm.findFirst({
      where: { name: classArmName, classLevel: { name: classLevelName } },
    });
    if (!classArm) {
      throw new Error(`No class arm "${classArmName}" found under class level "${classLevelName}"`);
    }

    const { parentProfileId, created: parentCreated } = await this.resolveParent(
      { email: parentEmailRaw, firstName: parentFirstName, lastName: parentLastName, phone: parentPhone, address: parentAddress },
      resolvedParentIdsByEmail,
    );

    const dto: CreateStudentDto = {
      firstName: studentFirstName,
      lastName: studentLastName,
      middleName: studentMiddleName,
      gender,
      admissionDate: new Date(admissionYear, 8, 1),
      classArmId: classArm.id,
      guardians: [
        { existingParentProfileId: parentProfileId, relationship, isPrimaryContact: true, isEmergencyContact: true },
      ],
    };
    const student = await this.studentService.create(dto, { admissionYearOverride: admissionYear });

    let openingBalanceCreated = false;
    if (outstanding > 0) {
      await this.invoiceService.createLegacyOpeningBalance({ studentId: student.id, termId, amount: outstanding });
      openingBalanceCreated = true;
    }

    return { parentCreated, openingBalanceCreated };
  }

  /**
   * Dedup key is email (not phone — the school's phone records aren't
   * reliable, per the explicit decision behind this feature). A brand-new
   * parent is created active with a random, never-communicated password —
   * same pattern seed-demo-data.ts's ensureRoleUser() uses — and,
   * deliberately, `sendInviteEmail` is never called.
   */
  private async resolveParent(
    guardian: { email: string; firstName: string; lastName: string; phone?: string; address?: string },
    resolvedParentIdsByEmail: Map<string, string>,
  ): Promise<{ parentProfileId: string; created: boolean }> {
    const email = UserService.normalizeEmail(guardian.email);

    const cached = resolvedParentIdsByEmail.get(email);
    if (cached) return { parentProfileId: cached, created: false };

    const existingUser = await this.prisma.user.findUnique({ where: { email } });
    if (existingUser) {
      const existingParent = await this.prisma.parentProfile.findUnique({ where: { userId: existingUser.id } });
      if (existingParent) {
        resolvedParentIdsByEmail.set(email, existingParent.id);
        return { parentProfileId: existingParent.id, created: false };
      }
      // Existing user (e.g. already STAFF) with no ParentProfile yet —
      // same FR1.5 "one person, one account" shape StudentService.
      // resolveGuardian handles inline; reuse it that way rather than
      // duplicating the grant-role logic here.
      const created = await this.prisma.parentProfile.create({ data: { userId: existingUser.id } });
      resolvedParentIdsByEmail.set(email, created.id);
      return { parentProfileId: created.id, created: false };
    }

    const { rawToken, userId } = await this.prisma.$transaction((tx) =>
      this.invitationService.createInTx(tx, {
        email,
        firstName: guardian.firstName,
        lastName: guardian.lastName,
        invitedRole: Role.PARENT,
      }),
    );
    const randomPassword = randomBytes(24).toString("hex");
    await this.invitationService.accept(rawToken, randomPassword);

    if (guardian.phone) await this.prisma.user.update({ where: { id: userId }, data: { phone: guardian.phone } });
    if (guardian.address) await this.prisma.parentProfile.update({ where: { userId }, data: { address: guardian.address } });

    const parentProfile = await this.prisma.parentProfile.findUniqueOrThrow({ where: { userId } });
    resolvedParentIdsByEmail.set(email, parentProfile.id);
    return { parentProfileId: parentProfile.id, created: true };
  }
}
