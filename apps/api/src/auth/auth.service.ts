import { Inject, Injectable, UnauthorizedException } from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import { UserStatus } from "@prisma/client";
import * as argon2 from "argon2";
import type Redis from "ioredis";
import { REDIS_CLIENT } from "../redis/redis.module";
import { generateRawToken, hashToken } from "../common/crypto/token";
import { PrismaService } from "../prisma/prisma.service";
import { UserService } from "../identity/users/user.service";

const REFRESH_TOKEN_TTL_SECONDS = 30 * 24 * 60 * 60; // 30 days
const REFRESH_KEY_PREFIX = "refresh:";

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
}

/**
 * PRD FR1.6/FR1.7, ARCHITECTURE.md §7 — no tenant/school-selection step:
 * this deployment has exactly one User table to check credentials against.
 * Access tokens are short-lived JWTs (`sub`, `roles`); refresh tokens are
 * opaque, hashed the same way as Invitation tokens (§token.ts), stored in
 * Redis so logout/password-change can revoke them immediately.
 */
@Injectable()
export class AuthService {
  constructor(
    private readonly userService: UserService,
    private readonly jwtService: JwtService,
    private readonly prisma: PrismaService,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
  ) {}

  async validateCredentials(email: string, password: string) {
    const user = await this.userService.findByEmail(email);
    if (!user || user.status !== UserStatus.active || !user.passwordHash) {
      return null;
    }

    const valid = await argon2.verify(user.passwordHash, password);
    return valid ? user : null;
  }

  async issueTokens(userId: string, roles: string[]): Promise<AuthTokens> {
    const assignmentTypes = await this.activeAssignmentTypes(userId);
    const accessToken = await this.jwtService.signAsync({ sub: userId, roles, assignmentTypes });
    const refreshToken = await this.storeNewRefreshToken(userId);
    return { accessToken, refreshToken };
  }

  /**
   * PRD §5: some permissions (e.g. Registrar-managed timetable) key off an
   * active StaffAssignment.assignmentType, not a Role. Embedded in the JWT
   * alongside `roles` — same staleness profile roles already has, no new
   * async surface for CASL's AbilityFactory.createForUser (called
   * synchronously in ~10 places).
   */
  async activeAssignmentTypes(userId: string): Promise<string[]> {
    const staffProfile = await this.prisma.staffProfile.findUnique({ where: { userId } });
    if (!staffProfile) return [];

    const assignments = await this.prisma.staffAssignment.findMany({
      where: { staffId: staffProfile.id, isActive: true },
      select: { assignmentType: true },
      distinct: ["assignmentType"],
    });
    return assignments.map((a) => a.assignmentType);
  }

  /** Rotates the refresh token: the presented one is invalidated whether or not this call succeeds past that point. */
  async refresh(presentedRefreshToken: string): Promise<AuthTokens> {
    const key = REFRESH_KEY_PREFIX + hashToken(presentedRefreshToken);
    const userId = await this.redis.get(key);
    if (!userId) throw new UnauthorizedException("Invalid or expired refresh token");

    await this.redis.del(key);

    const user = await this.userService.findById(userId);
    if (!user || user.status !== UserStatus.active) {
      throw new UnauthorizedException("Account is no longer active");
    }

    const roles = user.roles.filter((r) => r.isActive).map((r) => r.role);
    return this.issueTokens(user.id, roles);
  }

  async logout(presentedRefreshToken: string): Promise<void> {
    const key = REFRESH_KEY_PREFIX + hashToken(presentedRefreshToken);
    await this.redis.del(key);
  }

  /** PRD FR1.7: revocable on password change — every outstanding refresh token for this user is blacklisted. */
  async revokeAllRefreshTokens(userId: string): Promise<void> {
    let cursor = "0";
    do {
      const [nextCursor, keys] = await this.redis.scan(cursor, "MATCH", `${REFRESH_KEY_PREFIX}*`);
      cursor = nextCursor;
      for (const key of keys) {
        const value = await this.redis.get(key);
        if (value === userId) await this.redis.del(key);
      }
    } while (cursor !== "0");
  }

  private async storeNewRefreshToken(userId: string): Promise<string> {
    const rawToken = generateRawToken();
    const key = REFRESH_KEY_PREFIX + hashToken(rawToken);
    await this.redis.set(key, userId, "EX", REFRESH_TOKEN_TTL_SECONDS);
    return rawToken;
  }
}
