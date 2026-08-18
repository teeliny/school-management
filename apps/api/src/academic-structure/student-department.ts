import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Injectable,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from "@nestjs/common";
import { ClassLevelCategory } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { PoliciesGuard } from "../casl/policies.guard";
import { CheckPolicies } from "../casl/check-policies.decorator";
import { CreateStudentDepartmentDto, UpdateStudentDepartmentDto } from "./dto/student-department.dto";

// PRD §3.2/§3.3: assigns a student to a department for a session — only
// valid when the student's current ClassLevel.category = SSS. Service-layer
// check, not a DB constraint (same precedent as StaffAssignment's
// class-teacher rule).
@Injectable()
export class StudentDepartmentService {
  constructor(private readonly prisma: PrismaService) {}

  async create(dto: CreateStudentDepartmentDto) {
    const student = await this.prisma.studentProfile.findUniqueOrThrow({
      where: { id: dto.studentId },
      include: { currentClass: { include: { classLevel: true } } },
    });

    if (!student.currentClass || student.currentClass.classLevel.category !== ClassLevelCategory.SSS) {
      throw new BadRequestException("Department assignment is only valid for students in an SSS class level");
    }

    return this.prisma.studentDepartment.create({ data: dto });
  }

  findAll(filters: { studentId?: string; academicSessionId?: string }) {
    return this.prisma.studentDepartment.findMany({
      where: { studentId: filters.studentId, academicSessionId: filters.academicSessionId },
      include: { department: true },
      orderBy: { createdAt: "desc" },
    });
  }

  update(id: string, dto: UpdateStudentDepartmentDto) {
    return this.prisma.studentDepartment.update({ where: { id }, data: dto });
  }

  remove(id: string) {
    return this.prisma.studentDepartment.delete({ where: { id } });
  }
}

@Controller("student-departments")
@UseGuards(JwtAuthGuard, PoliciesGuard)
export class StudentDepartmentController {
  constructor(private readonly service: StudentDepartmentService) {}

  @Post()
  @CheckPolicies((ability) => ability.can("manage", "StudentDepartment"))
  create(@Body() dto: CreateStudentDepartmentDto) {
    return this.service.create(dto);
  }

  @Get()
  findAll(@Query("studentId") studentId?: string, @Query("academicSessionId") academicSessionId?: string) {
    return this.service.findAll({ studentId, academicSessionId });
  }

  @Patch(":id")
  @CheckPolicies((ability) => ability.can("manage", "StudentDepartment"))
  update(@Param("id") id: string, @Body() dto: UpdateStudentDepartmentDto) {
    return this.service.update(id, dto);
  }

  @Delete(":id")
  @CheckPolicies((ability) => ability.can("manage", "StudentDepartment"))
  remove(@Param("id") id: string) {
    return this.service.remove(id);
  }
}
