import { Role } from "@prisma/client";
import { StudentService } from "./student";
import type { CreateStudentDto } from "./dto/create-student.dto";

function buildTxMock() {
  return {
    user: { create: jest.fn(), findUnique: jest.fn() },
    userRole: { create: jest.fn() },
    studentProfile: { create: jest.fn() },
    studentGuardian: { create: jest.fn() },
    parentProfile: {
      create: jest.fn(),
      findUnique: jest.fn(),
      findUniqueOrThrow: jest.fn(),
    },
  };
}

function buildDto(guardian: CreateStudentDto["guardians"][number]): CreateStudentDto {
  return {
    firstName: "Ada",
    lastName: "Lovelace",
    admissionNumber: "ADM-001",
    admissionDate: new Date("2025-09-01"),
    guardians: [guardian],
  };
}

describe("StudentService.create — guardian resolution (PRD FR1.3/FR1.5)", () => {
  let tx: ReturnType<typeof buildTxMock>;
  let prisma: { $transaction: jest.Mock };
  let userService: { grantRole: jest.Mock };
  let invitationService: { createInTx: jest.Mock; sendInviteEmail: jest.Mock };
  let service: StudentService;

  beforeEach(() => {
    tx = buildTxMock();
    prisma = { $transaction: jest.fn((cb: (tx: unknown) => unknown) => cb(tx)) };
    userService = { grantRole: jest.fn() };
    invitationService = { createInTx: jest.fn(), sendInviteEmail: jest.fn() };

    tx.user.create.mockResolvedValue({ id: "student-user-1" });
    tx.studentProfile.create.mockResolvedValue({ id: "student-1" });

    service = new StudentService(
      prisma as never,
      userService as never,
      invitationService as never,
    );
  });

  it("links directly to an existing ParentProfile id without touching invitations or roles", async () => {
    tx.parentProfile.findUnique.mockResolvedValue({ id: "parent-existing" });

    const dto = buildDto({
      existingParentProfileId: "parent-existing",
      relationship: "MOTHER",
    } as CreateStudentDto["guardians"][number]);

    await service.create(dto);

    expect(tx.studentGuardian.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ parentId: "parent-existing" }) }),
    );
    expect(userService.grantRole).not.toHaveBeenCalled();
    expect(invitationService.createInTx).not.toHaveBeenCalled();
    expect(invitationService.sendInviteEmail).not.toHaveBeenCalled();
  });

  it("grants PARENT role and creates a fresh ParentProfile for an existing User (FR1.5)", async () => {
    tx.user.findUnique.mockResolvedValueOnce({ id: "existing-staff-user" }); // guardian email lookup
    tx.parentProfile.findUnique.mockResolvedValueOnce(null); // no ParentProfile yet
    tx.parentProfile.create.mockResolvedValueOnce({ id: "parent-new" });

    const dto = buildDto({
      email: "staff-parent@example.com",
      firstName: "Grace",
      lastName: "Hopper",
      relationship: "FATHER",
    } as CreateStudentDto["guardians"][number]);

    await service.create(dto);

    expect(userService.grantRole).toHaveBeenCalledWith("existing-staff-user", Role.PARENT, tx);
    expect(tx.parentProfile.create).toHaveBeenCalledWith({ data: { userId: "existing-staff-user" } });
    expect(tx.studentGuardian.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ parentId: "parent-new" }) }),
    );
    expect(invitationService.createInTx).not.toHaveBeenCalled();
  });

  it("inline-invites a brand-new guardian and sends the email after commit", async () => {
    tx.user.findUnique.mockResolvedValueOnce(null); // no existing user for that email
    invitationService.createInTx.mockResolvedValueOnce({
      invitation: { email: "new-parent@example.com" },
      rawToken: "raw-token-123",
      userId: "invited-user-1",
    });
    tx.parentProfile.findUniqueOrThrow.mockResolvedValueOnce({ id: "parent-invited" });

    const dto = buildDto({
      email: "new-parent@example.com",
      firstName: "New",
      lastName: "Parent",
      relationship: "GUARDIAN",
    } as CreateStudentDto["guardians"][number]);

    await service.create(dto);

    expect(invitationService.createInTx).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({ email: "new-parent@example.com", invitedRole: Role.PARENT }),
    );
    expect(tx.studentGuardian.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ parentId: "parent-invited" }) }),
    );
    // Email is sent only after the transaction (and its callback) resolves.
    expect(invitationService.sendInviteEmail).toHaveBeenCalledWith(
      "new-parent@example.com",
      "raw-token-123",
    );
  });
});
