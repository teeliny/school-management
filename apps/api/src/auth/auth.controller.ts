import { Body, Controller, Get, HttpCode, HttpStatus, Post, UnauthorizedException, UseGuards } from "@nestjs/common";
import { AuthService } from "./auth.service";
import { LoginDto } from "./dto/login.dto";
import { RefreshDto } from "./dto/refresh.dto";
import { ForgotPasswordDto } from "./dto/forgot-password.dto";
import { ResetPasswordDto } from "./dto/reset-password.dto";
import { JwtAuthGuard } from "./jwt-auth.guard";
import { CurrentUser } from "./current-user.decorator";
import type { RequestUser } from "./jwt.strategy";
import { UserService } from "../identity/users/user.service";
import { Audited } from "../audit/audited.decorator";
import { PrismaService } from "../prisma/prisma.service";

@Controller("auth")
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly userService: UserService,
    private readonly prisma: PrismaService,
  ) {}

  @Post("login")
  async login(@Body() dto: LoginDto) {
    const user = await this.authService.validateCredentials(dto.email, dto.password);
    if (!user) throw new UnauthorizedException("Invalid email or password");

    const roles = user.roles.filter((r) => r.isActive).map((r) => r.role);
    return this.authService.issueTokens(user.id, roles);
  }

  @Post("refresh")
  @HttpCode(HttpStatus.OK)
  refresh(@Body() dto: RefreshDto) {
    return this.authService.refresh(dto.refreshToken);
  }

  @Post("logout")
  @HttpCode(HttpStatus.NO_CONTENT)
  async logout(@Body() dto: RefreshDto) {
    await this.authService.logout(dto.refreshToken);
  }

  // Always the same generic response regardless of whether the email is
  // registered — no account enumeration via the response body.
  @Post("forgot-password")
  @HttpCode(HttpStatus.OK)
  async forgotPassword(@Body() dto: ForgotPasswordDto) {
    await this.authService.forgotPassword(dto.email);
    return { message: "If that email is registered, a reset link has been sent." };
  }

  @Post("reset-password")
  @HttpCode(HttpStatus.OK)
  @Audited("User")
  async resetPassword(@Body() dto: ResetPasswordDto) {
    return this.authService.resetPassword(dto.token, dto.newPassword);
  }

  @Get("me")
  @UseGuards(JwtAuthGuard)
  async me(@CurrentUser() currentUser: RequestUser) {
    const user = await this.userService.findById(currentUser.id);
    if (!user) throw new UnauthorizedException();

    // BUILD_PLAN.md §9 Step 6c: "who am I, concretely" — a plain STAFF user
    // can't call GET /staff-profiles (CASL-gated to Admin/Super-Admin/
    // Registrar) to find their own StaffProfile.id, and there was no
    // equivalent self-lookup for any of the three profile kinds. Purely
    // additive to the existing response shape (each nullable), so every
    // other /auth/me consumer is unaffected.
    const [staffProfile, studentProfile, parentProfile] = await Promise.all([
      this.prisma.staffProfile.findUnique({ where: { userId: user.id }, select: { id: true } }),
      this.prisma.studentProfile.findUnique({ where: { userId: user.id }, select: { id: true } }),
      this.prisma.parentProfile.findUnique({ where: { userId: user.id }, select: { id: true } }),
    ]);

    return {
      id: user.id,
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
      roles: user.roles.filter((r) => r.isActive).map((r) => r.role),
      assignmentTypes: await this.authService.activeAssignmentTypes(user.id),
      staffProfileId: staffProfile?.id ?? null,
      studentProfileId: studentProfile?.id ?? null,
      parentProfileId: parentProfile?.id ?? null,
    };
  }
}
