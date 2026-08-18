import { InvoiceService } from "./invoice";
import { AbilityFactory } from "../casl/ability.factory";
import type { RequestUser } from "../auth/jwt.strategy";

const abilityFactory = new AbilityFactory();

const BURSAR: RequestUser = { id: "bursar-1", roles: ["STAFF"], assignmentTypes: ["BURSAR"] };
const SUPER_ADMIN: RequestUser = { id: "super-1", roles: ["SUPER_ADMIN"], assignmentTypes: [] };
const ADMIN: RequestUser = { id: "admin-1", roles: ["ADMIN"], assignmentTypes: [] };
const PARENT: RequestUser = { id: "parent-user-1", roles: ["PARENT"], assignmentTypes: [] };

const TERM = { id: "term-1", academicSessionId: "session-1" };

function buildPrismaMock() {
  const tx = {
    invoice: { create: jest.fn().mockResolvedValue({ id: "invoice-1" }) },
    invoiceLineItem: { createMany: jest.fn().mockResolvedValue({ count: 1 }) },
  };
  return {
    term: { findUniqueOrThrow: jest.fn().mockResolvedValue(TERM) },
    studentProfile: { findMany: jest.fn().mockResolvedValue([]) },
    feeStructure: { findMany: jest.fn().mockResolvedValue([]) },
    invoice: {
      findUnique: jest.fn().mockResolvedValue(null),
      findUniqueOrThrow: jest.fn(),
      findMany: jest.fn().mockResolvedValue([]),
      count: jest.fn().mockResolvedValue(0),
    },
    parentProfile: { findUnique: jest.fn() },
    $transaction: jest.fn((arg: unknown) => {
      if (typeof arg === "function") return (arg as (tx: typeof tx) => unknown)(tx);
      return Promise.all(arg as Promise<unknown>[]);
    }),
    __tx: tx,
  };
}

function buildDto(overrides: Partial<{ termId: string; classLevelId?: string; dueDate: Date }> = {}) {
  return { termId: "term-1", dueDate: new Date("2026-09-30"), ...overrides };
}

describe("InvoiceService.generate (PRD FR7.2)", () => {
  let prisma: ReturnType<typeof buildPrismaMock>;
  let service: InvoiceService;

  beforeEach(() => {
    prisma = buildPrismaMock();
    service = new InvoiceService(prisma as never);
  });

  it("creates one invoice with FEE line items summing the applicable fee structures", async () => {
    prisma.studentProfile.findMany.mockResolvedValue([{ id: "student-1", currentClass: { classLevelId: "level-1" } }]);
    prisma.feeStructure.findMany.mockResolvedValue([
      { id: "fs-schoolwide", classLevelId: null, amount: 5000, name: "Tuition" },
      { id: "fs-level", classLevelId: "level-1", amount: 2000, name: "PTA Levy" },
    ]);

    const result = await service.generate(buildDto());

    expect(prisma.__tx.invoice.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ studentId: "student-1", termId: "term-1", totalAmount: 7000 }) }),
    );
    expect(prisma.__tx.invoiceLineItem.createMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.arrayContaining([
          expect.objectContaining({ feeStructureId: "fs-schoolwide", amount: 5000, type: "FEE" }),
          expect.objectContaining({ feeStructureId: "fs-level", amount: 2000, type: "FEE" }),
        ]),
      }),
    );
    expect(result).toEqual({ created: 1, alreadyInvoiced: 0, noApplicableFees: 0 });
  });

  it("excludes a fee structure scoped to a different class level", async () => {
    prisma.studentProfile.findMany.mockResolvedValue([{ id: "student-1", currentClass: { classLevelId: "level-1" } }]);
    prisma.feeStructure.findMany.mockResolvedValue([
      { id: "fs-mine", classLevelId: "level-1", amount: 2000, name: "PTA Levy" },
      { id: "fs-other", classLevelId: "level-2", amount: 9000, name: "Other level fee" },
    ]);

    await service.generate(buildDto());

    expect(prisma.__tx.invoice.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ totalAmount: 2000 }) }),
    );
  });

  it("skips a student who already has an invoice for the term", async () => {
    prisma.studentProfile.findMany.mockResolvedValue([{ id: "student-1", currentClass: { classLevelId: "level-1" } }]);
    prisma.feeStructure.findMany.mockResolvedValue([{ id: "fs-1", classLevelId: null, amount: 5000, name: "Tuition" }]);
    prisma.invoice.findMany.mockResolvedValue([{ studentId: "student-1" }]);

    const result = await service.generate(buildDto());

    expect(prisma.__tx.invoice.create).not.toHaveBeenCalled();
    expect(result).toEqual({ created: 0, alreadyInvoiced: 1, noApplicableFees: 0 });
  });

  it("skips a student with zero applicable fee structures", async () => {
    prisma.studentProfile.findMany.mockResolvedValue([{ id: "student-1", currentClass: { classLevelId: "level-1" } }]);
    prisma.feeStructure.findMany.mockResolvedValue([{ id: "fs-other", classLevelId: "level-2", amount: 9000, name: "Other level fee" }]);

    const result = await service.generate(buildDto());

    expect(prisma.__tx.invoice.create).not.toHaveBeenCalled();
    expect(result).toEqual({ created: 0, alreadyInvoiced: 0, noApplicableFees: 1 });
  });
});

describe("InvoiceService read scoping (PRD §5 — Admin has no visibility into Fees)", () => {
  let prisma: ReturnType<typeof buildPrismaMock>;
  let service: InvoiceService;

  beforeEach(() => {
    prisma = buildPrismaMock();
    service = new InvoiceService(prisma as never);
  });

  it("Bursar/Super-Admin see every invoice, unscoped", async () => {
    for (const user of [BURSAR, SUPER_ADMIN]) {
      prisma.invoice.findMany.mockClear();
      const ability = abilityFactory.createForUser(user);
      await service.findAllForUser(user, ability);
      expect(prisma.invoice.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.not.objectContaining({ student: expect.anything() }) }),
      );
    }
  });

  it("a parent sees only invoices for students she guardians", async () => {
    prisma.parentProfile.findUnique.mockResolvedValue({ id: "parent-profile-1" });
    const ability = abilityFactory.createForUser(PARENT);

    await service.findAllForUser(PARENT, ability);

    expect(prisma.invoice.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ student: { guardians: { some: { parentId: "parent-profile-1" } } } }),
      }),
    );
  });

  it("a parent with no ParentProfile gets an empty list, not an unscoped one", async () => {
    prisma.parentProfile.findUnique.mockResolvedValue(null);
    const ability = abilityFactory.createForUser(PARENT);

    const result = await service.findAllForUser(PARENT, ability);

    expect(result).toEqual([]);
    expect(prisma.invoice.findMany).not.toHaveBeenCalled();
  });

  it("a plain ADMIN (no Bursar assignment) gets an empty list — Admin has zero visibility into Fees", async () => {
    const ability = abilityFactory.createForUser(ADMIN);

    const result = await service.findAllForUser(ADMIN, ability);

    expect(result).toEqual([]);
    expect(prisma.invoice.findMany).not.toHaveBeenCalled();
  });

  it("findOneForUser lets a parent view her ward's invoice", async () => {
    prisma.invoice.findUniqueOrThrow.mockResolvedValue({
      id: "invoice-1",
      totalAmount: 5000,
      lineItems: [],
      payments: [],
      student: { guardians: [{ parentId: "parent-profile-1" }] },
    });
    prisma.parentProfile.findUnique.mockResolvedValue({ id: "parent-profile-1" });
    const ability = abilityFactory.createForUser(PARENT);

    const result = await service.findOneForUser("invoice-1", PARENT, ability);

    expect(result.outstandingBalance).toBe(5000);
  });

  it("regression: FEE-type line items are NOT summed into outstandingBalance a second time — totalAmount already includes them", async () => {
    // Realistic shape: totalAmount was set at generation time to the sum of
    // these two FEE lines (5000). A bug here previously double-counted them
    // (outstandingBalance came out as 10000 instead of 5000), caught via
    // empirical curl verification against real generated invoices rather
    // than these mocked-Prisma tests, since every earlier test used
    // `lineItems: []`.
    prisma.invoice.findUniqueOrThrow.mockResolvedValue({
      id: "invoice-1",
      totalAmount: 5000,
      lineItems: [
        { amount: 4000, type: "FEE" },
        { amount: 1000, type: "FEE" },
      ],
      payments: [],
      student: { guardians: [{ parentId: "parent-profile-1" }] },
    });
    prisma.parentProfile.findUnique.mockResolvedValue({ id: "parent-profile-1" });
    const ability = abilityFactory.createForUser(PARENT);

    const result = await service.findOneForUser("invoice-1", PARENT, ability);

    expect(result.outstandingBalance).toBe(5000);
  });

  it("a DISCOUNT-type line item does reduce outstandingBalance, on top of totalAmount", async () => {
    prisma.invoice.findUniqueOrThrow.mockResolvedValue({
      id: "invoice-1",
      totalAmount: 5000,
      lineItems: [
        { amount: 5000, type: "FEE" },
        { amount: -1000, type: "DISCOUNT" },
      ],
      payments: [],
      student: { guardians: [{ parentId: "parent-profile-1" }] },
    });
    prisma.parentProfile.findUnique.mockResolvedValue({ id: "parent-profile-1" });
    const ability = abilityFactory.createForUser(PARENT);

    const result = await service.findOneForUser("invoice-1", PARENT, ability);

    expect(result.outstandingBalance).toBe(4000);
  });

  it("findOneForUser rejects a parent viewing another family's invoice", async () => {
    prisma.invoice.findUniqueOrThrow.mockResolvedValue({
      id: "invoice-1",
      totalAmount: 5000,
      lineItems: [],
      payments: [],
      student: { guardians: [{ parentId: "someone-elses-parent-profile" }] },
    });
    prisma.parentProfile.findUnique.mockResolvedValue({ id: "parent-profile-1" });
    const ability = abilityFactory.createForUser(PARENT);

    await expect(service.findOneForUser("invoice-1", PARENT, ability)).rejects.toThrow(/Insufficient permissions/);
  });
});
