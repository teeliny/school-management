import { FeeStructureStudentAssignmentService } from "./fee-structure-student-assignment";
import type { RequestUser } from "../auth/jwt.strategy";

const BURSAR: RequestUser = { id: "bursar-user-1", roles: ["STAFF"], assignmentTypes: ["BURSAR"] };

const OPTIONAL_FEE_STRUCTURE = {
  id: "fs-optional",
  termId: "term-1",
  name: "Textbooks",
  amount: 10000,
  isMandatory: false,
  classLevels: [],
};

const STUDENT = { id: "student-1", currentClass: { classLevelId: "level-1" } };

const REGULAR_INVOICE = { id: "regular-invoice-1", dueDate: new Date("2026-09-30") };

function buildPrismaMock() {
  const tx = {
    invoice: {
      create: jest.fn().mockResolvedValue({ id: "supplementary-invoice-1" }),
      update: jest.fn().mockResolvedValue({}),
      findUniqueOrThrow: jest.fn().mockResolvedValue({ id: "supplementary-invoice-1" }),
    },
    invoiceLineItem: { createMany: jest.fn().mockResolvedValue({ count: 1 }) },
    feeStructureStudentAssignment: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
  };
  // Two distinct findFirst lookups happen per create(): one for the term's
  // REGULAR invoice, one for an open (non-PAID) SUPPLEMENTARY invoice —
  // dispatched here by `where.source` so each test can set each
  // independently rather than relying on call order.
  let regularInvoice: unknown = null;
  let openSupplementaryInvoice: unknown = null;
  const findFirst = jest.fn((args: { where: { source: "REGULAR" | "SUPPLEMENTARY" } }) =>
    Promise.resolve(args.where.source === "REGULAR" ? regularInvoice : openSupplementaryInvoice),
  );
  return {
    feeStructure: { findUniqueOrThrow: jest.fn().mockResolvedValue(OPTIONAL_FEE_STRUCTURE) },
    studentProfile: { findUniqueOrThrow: jest.fn().mockResolvedValue(STUDENT) },
    staffProfile: { findUnique: jest.fn().mockResolvedValue({ id: "staff-profile-1" }) },
    feeStructureStudentAssignment: {
      findUnique: jest.fn().mockResolvedValue(null),
      findUniqueOrThrow: jest.fn().mockResolvedValue({ id: "assignment-1" }),
      findMany: jest.fn().mockResolvedValue([]),
      create: jest.fn().mockResolvedValue({ id: "assignment-1" }),
    },
    invoice: { findFirst },
    $transaction: jest.fn((arg: unknown) => {
      if (typeof arg === "function") return (arg as (tx: typeof tx) => unknown)(tx);
      return Promise.all(arg as Promise<unknown>[]);
    }),
    __tx: tx,
    __setRegularInvoice: (value: unknown) => {
      regularInvoice = value;
    },
    __setOpenSupplementaryInvoice: (value: unknown) => {
      openSupplementaryInvoice = value;
    },
  };
}

function buildDto(overrides: Partial<{ studentId: string; feeStructureId: string; dueDate: Date }> = {}) {
  return { studentId: "student-1", feeStructureId: "fs-optional", ...overrides };
}

describe("FeeStructureStudentAssignmentService.create", () => {
  let prisma: ReturnType<typeof buildPrismaMock>;
  let service: FeeStructureStudentAssignmentService;

  beforeEach(() => {
    prisma = buildPrismaMock();
    service = new FeeStructureStudentAssignmentService(prisma as never);
  });

  it("rejects opting into a mandatory fee structure", async () => {
    prisma.feeStructure.findUniqueOrThrow.mockResolvedValue({ ...OPTIONAL_FEE_STRUCTURE, isMandatory: true });

    await expect(service.create(buildDto(), BURSAR)).rejects.toThrow(/non-mandatory/);
  });

  it("rejects a fee structure that doesn't apply to the student's class", async () => {
    prisma.feeStructure.findUniqueOrThrow.mockResolvedValue({
      ...OPTIONAL_FEE_STRUCTURE,
      classLevels: [{ classLevelId: "some-other-level" }],
    });

    await expect(service.create(buildDto(), BURSAR)).rejects.toThrow(/does not apply/);
  });

  it("rejects a duplicate opt-in for the same student and fee structure", async () => {
    prisma.feeStructureStudentAssignment.findUnique.mockResolvedValue({ id: "existing-assignment" });

    await expect(service.create(buildDto(), BURSAR)).rejects.toThrow(/already opted in/);
  });

  it("when no REGULAR invoice exists yet for the term, records the opt-in and returns no supplementary invoice", async () => {
    const result = await service.create(buildDto(), BURSAR);

    expect(result.supplementaryInvoice).toBeNull();
    expect(prisma.__tx.invoice.create).not.toHaveBeenCalled();
  });

  it("when a REGULAR invoice already exists for the term and no SUPPLEMENTARY invoice is open, immediately bills the opt-in on a new SUPPLEMENTARY invoice, leaving the original untouched", async () => {
    prisma.__setRegularInvoice(REGULAR_INVOICE);
    prisma.feeStructureStudentAssignment.findMany.mockResolvedValue([
      { id: "assignment-1", feeStructureId: "fs-optional", feeStructure: OPTIONAL_FEE_STRUCTURE },
    ]);

    const result = await service.create(buildDto(), BURSAR);

    expect(prisma.__tx.invoice.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ studentId: "student-1", termId: "term-1", totalAmount: 10000, source: "SUPPLEMENTARY" }),
      }),
    );
    // The REGULAR invoice itself is never written to.
    expect(prisma.__tx.invoice.update).not.toHaveBeenCalled();
    expect(result.supplementaryInvoice).toEqual({ id: "supplementary-invoice-1" });
  });

  it("batches every other still-pending opt-in for the same student+term onto the one new SUPPLEMENTARY invoice", async () => {
    prisma.__setRegularInvoice(REGULAR_INVOICE);
    prisma.feeStructureStudentAssignment.findMany.mockResolvedValue([
      { id: "assignment-1", feeStructureId: "fs-optional", feeStructure: OPTIONAL_FEE_STRUCTURE },
      { id: "assignment-2", feeStructureId: "fs-other-optional", feeStructure: { ...OPTIONAL_FEE_STRUCTURE, id: "fs-other-optional", amount: 3000, name: "Uniform" } },
    ]);

    await service.create(buildDto(), BURSAR);

    expect(prisma.__tx.invoice.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ totalAmount: 13000 }) }));
    expect(prisma.__tx.invoiceLineItem.createMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.arrayContaining([
          expect.objectContaining({ feeStructureId: "fs-optional", amount: 10000 }),
          expect.objectContaining({ feeStructureId: "fs-other-optional", amount: 3000 }),
        ]),
      }),
    );
    expect(prisma.__tx.feeStructureStudentAssignment.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: { in: ["assignment-1", "assignment-2"] } }, data: { invoiceId: "supplementary-invoice-1" } }),
    );
  });

  it("appends a later opt-in to the still-open (non-PAID) SUPPLEMENTARY invoice instead of creating a new one", async () => {
    prisma.__setRegularInvoice(REGULAR_INVOICE);
    prisma.__setOpenSupplementaryInvoice({
      id: "supplementary-invoice-1",
      totalAmount: 3000,
      dueDate: new Date("2026-09-30"),
      lineItems: [{ type: "FEE", amount: 3000 }],
      payments: [],
    });
    prisma.feeStructureStudentAssignment.findMany.mockResolvedValue([
      { id: "assignment-2", feeStructureId: "fs-optional", feeStructure: OPTIONAL_FEE_STRUCTURE },
    ]);

    const result = await service.create(buildDto(), BURSAR);

    expect(prisma.__tx.invoice.create).not.toHaveBeenCalled();
    expect(prisma.__tx.invoice.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "supplementary-invoice-1" }, data: expect.objectContaining({ totalAmount: 13000, status: "UNPAID" }) }),
    );
    expect(prisma.__tx.invoiceLineItem.createMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.arrayContaining([expect.objectContaining({ invoiceId: "supplementary-invoice-1" })]) }),
    );
    expect(prisma.__tx.feeStructureStudentAssignment.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: { invoiceId: "supplementary-invoice-1" } }),
    );
    expect(result.supplementaryInvoice).toEqual({ id: "supplementary-invoice-1" });
  });

  it("starts a fresh SUPPLEMENTARY invoice when the previous one has already been fully paid", async () => {
    prisma.__setRegularInvoice(REGULAR_INVOICE);
    // status: { not: "PAID" } in the real query already excludes a paid
    // invoice, so the mock reflects that by returning null here.
    prisma.__setOpenSupplementaryInvoice(null);
    prisma.feeStructureStudentAssignment.findMany.mockResolvedValue([
      { id: "assignment-2", feeStructureId: "fs-optional", feeStructure: OPTIONAL_FEE_STRUCTURE },
    ]);

    await service.create(buildDto(), BURSAR);

    expect(prisma.__tx.invoice.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ totalAmount: 10000 }) }));
    expect(prisma.__tx.invoice.update).not.toHaveBeenCalled();
  });
});
