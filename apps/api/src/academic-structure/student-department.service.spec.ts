import { ClassLevelCategory } from "@prisma/client";
import { StudentDepartmentService } from "./student-department";
import type { CreateStudentDepartmentDto } from "./dto/student-department.dto";

function buildPrismaMock() {
  return {
    studentProfile: { findUniqueOrThrow: jest.fn() },
    studentDepartment: { create: jest.fn() },
  };
}

describe("StudentDepartmentService.create (PRD §3.2/§3.3 — SSS-only gate)", () => {
  let prisma: ReturnType<typeof buildPrismaMock>;
  let service: StudentDepartmentService;

  function buildDto(overrides: Partial<CreateStudentDepartmentDto> = {}): CreateStudentDepartmentDto {
    return {
      studentId: "student-1",
      departmentId: "dept-science",
      academicSessionId: "session-1",
      ...overrides,
    };
  }

  beforeEach(() => {
    prisma = buildPrismaMock();
    service = new StudentDepartmentService(prisma as never);
  });

  it("rejects a student whose current class level is not SSS", async () => {
    prisma.studentProfile.findUniqueOrThrow.mockResolvedValue({
      currentClass: { classLevel: { category: ClassLevelCategory.JSS } },
    });

    await expect(service.create(buildDto())).rejects.toThrow(/SSS/);
    expect(prisma.studentDepartment.create).not.toHaveBeenCalled();
  });

  it("rejects a student with no current class assignment", async () => {
    prisma.studentProfile.findUniqueOrThrow.mockResolvedValue({ currentClass: null });

    await expect(service.create(buildDto())).rejects.toThrow(/SSS/);
    expect(prisma.studentDepartment.create).not.toHaveBeenCalled();
  });

  it("allows a student whose current class level is SSS", async () => {
    prisma.studentProfile.findUniqueOrThrow.mockResolvedValue({
      currentClass: { classLevel: { category: ClassLevelCategory.SSS } },
    });
    prisma.studentDepartment.create.mockResolvedValue({ id: "sd-1" });

    await service.create(buildDto());

    expect(prisma.studentDepartment.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: buildDto() }),
    );
  });
});
