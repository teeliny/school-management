import { Injectable } from "@nestjs/common";
import { Prisma, Role, User, UserStatus } from "@prisma/client";
import { PrismaService } from "../../prisma/prisma.service";

// eslint-disable-next-line @typescript-eslint/no-unused-vars -- used only for `typeof` below, the standard Prisma pattern for deriving a payload type
const userWithRoles = Prisma.validator<Prisma.UserDefaultArgs>()({
  include: { roles: true },
});
export type UserWithRoles = Prisma.UserGetPayload<typeof userWithRoles>;

@Injectable()
export class UserService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * PRD §3.1 specifies `email citext, unique` for case-insensitive login.
   * Rather than the Postgres citext extension, this normalization is the
   * single choke point that makes plain `String @unique` behave the same
   * way — every write and lookup goes through here (ARCHITECTURE.md §7).
   */
  static normalizeEmail(email: string): string {
    return email.trim().toLowerCase();
  }

  findByEmail(email: string): Promise<UserWithRoles | null> {
    return this.prisma.user.findUnique({
      where: { email: UserService.normalizeEmail(email) },
      include: { roles: true },
    });
  }

  findById(id: string): Promise<UserWithRoles | null> {
    return this.prisma.user.findUnique({
      where: { id },
      include: { roles: true },
    });
  }

  async activateWithPassword(userId: string, passwordHash: string): Promise<User> {
    return this.prisma.user.update({
      where: { id: userId },
      data: { passwordHash, status: UserStatus.active },
    });
  }

  /**
   * Grants a role, reactivating an existing inactive row for the same role
   * rather than accumulating duplicates. One person can hold several roles
   * at once (e.g. STAFF + PARENT, PRD FR1.5) — each role is its own row.
   * Accepts an optional transaction client so callers composing a larger
   * atomic operation (StudentService's guardian linking, ownership
   * transfer) can call this within their own `$transaction`.
   */
  async grantRole(userId: string, role: Role, client: Prisma.TransactionClient | PrismaService = this.prisma) {
    const existing = await client.userRole.findFirst({ where: { userId, role } });
    if (existing) {
      if (existing.isActive) return existing;
      return client.userRole.update({ where: { id: existing.id }, data: { isActive: true } });
    }
    return client.userRole.create({ data: { userId, role } });
  }
}
