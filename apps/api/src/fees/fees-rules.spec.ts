import { computeInvoiceStatus, computeOutstandingBalance } from "@school/types";

const DUE_DATE = new Date("2026-09-30T00:00:00.000Z");
const BEFORE_DUE = new Date("2026-09-15T00:00:00.000Z");
const AFTER_DUE = new Date("2026-10-05T00:00:00.000Z");

describe("computeOutstandingBalance (PRD §3.9)", () => {
  it("returns the full totalAmount when there are no payments or discounts", () => {
    expect(computeOutstandingBalance(50000, [], [])).toBe(50000);
  });

  it("subtracts successful payments", () => {
    expect(computeOutstandingBalance(50000, [], [20000, 10000])).toBe(20000);
  });

  it("applies a DISCOUNT line item (negative amount) before subtracting payments", () => {
    expect(computeOutstandingBalance(50000, [-5000], [20000])).toBe(25000);
  });

  it("goes negative when overpaid, rather than clamping to zero", () => {
    expect(computeOutstandingBalance(50000, [], [60000])).toBe(-10000);
  });
});

describe("computeInvoiceStatus (PRD §3.9)", () => {
  it("is UNPAID with no payments and before the due date", () => {
    expect(computeInvoiceStatus(50000, 0, DUE_DATE, BEFORE_DUE)).toBe("UNPAID");
  });

  it("is PARTIAL once some (but not all) has been paid, before the due date", () => {
    expect(computeInvoiceStatus(20000, 30000, DUE_DATE, BEFORE_DUE)).toBe("PARTIAL");
  });

  it("is PAID once the outstanding balance reaches zero", () => {
    expect(computeInvoiceStatus(0, 50000, DUE_DATE, BEFORE_DUE)).toBe("PAID");
  });

  it("is PAID even when overpaid (negative outstanding balance)", () => {
    expect(computeInvoiceStatus(-10000, 60000, DUE_DATE, BEFORE_DUE)).toBe("PAID");
  });

  it("is OVERDUE once the due date passes with nothing paid", () => {
    expect(computeInvoiceStatus(50000, 0, DUE_DATE, AFTER_DUE)).toBe("OVERDUE");
  });

  it("OVERDUE takes priority over PARTIAL — a partial payment past the due date is still OVERDUE, not PARTIAL", () => {
    expect(computeInvoiceStatus(20000, 30000, DUE_DATE, AFTER_DUE)).toBe("OVERDUE");
  });

  it("is PAID rather than OVERDUE once fully paid, even past the due date", () => {
    expect(computeInvoiceStatus(0, 50000, DUE_DATE, AFTER_DUE)).toBe("PAID");
  });
});
