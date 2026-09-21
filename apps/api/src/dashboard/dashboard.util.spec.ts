import { rankMostAbsentStaff } from "./dashboard.util";

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
