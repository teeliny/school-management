import { buildIncomeReport, rankMostAbsentStaff } from "./dashboard.util";

describe("rankMostAbsentStaff", () => {
  const directory = new Map([
    ["staff-1", { employeeId: "EMP-1", firstName: "Ada", lastName: "Okoye" }],
    ["staff-2", { employeeId: "EMP-2", firstName: "Bola", lastName: "Adeyemi" }],
    ["staff-3", { employeeId: "EMP-3", firstName: "Chidi", lastName: "Eze" }],
  ]);

  it("ranks staff by absence count, worst first", () => {
    const records = [
      { personId: "staff-1", status: "ABSENT" as const },
      { personId: "staff-1", status: "ABSENT" as const },
      { personId: "staff-2", status: "ABSENT" as const },
      { personId: "staff-2", status: "ABSENT" as const },
      { personId: "staff-2", status: "ABSENT" as const },
      { personId: "staff-3", status: "PRESENT" as const },
    ];

    const ranked = rankMostAbsentStaff(records, directory, 5);

    expect(ranked.map((r) => r.staffId)).toEqual(["staff-2", "staff-1"]);
    expect(ranked[0]).toMatchObject({ staffId: "staff-2", employeeId: "EMP-2", firstName: "Bola", lastName: "Adeyemi", absent: 3 });
  });

  it("excludes staff with zero absences even if they have other statuses", () => {
    const records = [
      { personId: "staff-3", status: "PRESENT" as const },
      { personId: "staff-3", status: "LATE" as const },
    ];

    expect(rankMostAbsentStaff(records, directory, 5)).toEqual([]);
  });

  it("respects the limit", () => {
    const records = [
      { personId: "staff-1", status: "ABSENT" as const },
      { personId: "staff-2", status: "ABSENT" as const },
      { personId: "staff-2", status: "ABSENT" as const },
      { personId: "staff-3", status: "ABSENT" as const },
      { personId: "staff-3", status: "ABSENT" as const },
      { personId: "staff-3", status: "ABSENT" as const },
    ];

    const ranked = rankMostAbsentStaff(records, directory, 2);

    expect(ranked).toHaveLength(2);
    expect(ranked.map((r) => r.staffId)).toEqual(["staff-3", "staff-2"]);
  });

  it("falls back to null name fields for a staffId missing from the directory", () => {
    const ranked = rankMostAbsentStaff([{ personId: "unknown-staff", status: "ABSENT" as const }], directory, 5);

    expect(ranked[0]).toMatchObject({ staffId: "unknown-staff", employeeId: null, firstName: null, lastName: null, absent: 1 });
  });
});

describe("buildIncomeReport", () => {
  it("buckets payments by paidAt day and totals the grand sum/count", () => {
    const report = buildIncomeReport([
      { amount: 5000, paidAt: new Date("2026-03-01T09:00:00.000Z"), method: "CASH" as const, gatewayProvider: null },
      { amount: 2000, paidAt: new Date("2026-03-01T15:00:00.000Z"), method: "BANK_TRANSFER_MANUAL" as const, gatewayProvider: null },
      { amount: 3000, paidAt: new Date("2026-03-02T09:00:00.000Z"), method: "GATEWAY_CARD" as const, gatewayProvider: "PAYSTACK" as const },
    ]);

    expect(report.totalIncome).toBe(10000);
    expect(report.totalCount).toBe(3);
    expect(report.dailyIncome).toEqual([
      { date: "2026-03-01", total: 7000, count: 2 },
      { date: "2026-03-02", total: 3000, count: 1 },
    ]);
  });

  it("tallies subtotals by method, sorted highest total first", () => {
    const report = buildIncomeReport([
      { amount: 1000, paidAt: new Date("2026-03-01"), method: "CASH" as const, gatewayProvider: null },
      { amount: 5000, paidAt: new Date("2026-03-01"), method: "BANK_TRANSFER_MANUAL" as const, gatewayProvider: null },
      { amount: 2000, paidAt: new Date("2026-03-02"), method: "CASH" as const, gatewayProvider: null },
    ]);

    expect(report.byMethod).toEqual([
      { method: "BANK_TRANSFER_MANUAL", total: 5000, count: 1 },
      { method: "CASH", total: 3000, count: 2 },
    ]);
  });

  it("only tallies a gateway subtotal for payments that actually carry a gatewayProvider", () => {
    const report = buildIncomeReport([
      { amount: 4000, paidAt: new Date("2026-03-01"), method: "GATEWAY_CARD" as const, gatewayProvider: "MONNIFY" as const },
      { amount: 6000, paidAt: new Date("2026-03-01"), method: "GATEWAY_TRANSFER" as const, gatewayProvider: "PAYSTACK" as const },
      { amount: 1000, paidAt: new Date("2026-03-01"), method: "CASH" as const, gatewayProvider: null },
    ]);

    expect(report.byGateway).toEqual([
      { gatewayProvider: "PAYSTACK", total: 6000, count: 1 },
      { gatewayProvider: "MONNIFY", total: 4000, count: 1 },
    ]);
  });

  it("skips a payment with no paidAt rather than crashing on it", () => {
    const report = buildIncomeReport([
      { amount: 1000, paidAt: null, method: "CASH" as const, gatewayProvider: null },
      { amount: 2000, paidAt: new Date("2026-03-01"), method: "CASH" as const, gatewayProvider: null },
    ]);

    expect(report.totalIncome).toBe(2000);
    expect(report.totalCount).toBe(1);
  });

  it("returns zeroed totals and empty breakdowns for an empty date range", () => {
    expect(buildIncomeReport([])).toEqual({ totalIncome: 0, totalCount: 0, dailyIncome: [], byMethod: [], byGateway: [] });
  });
});
