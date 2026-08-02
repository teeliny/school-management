import { Body, Controller, Get, HttpCode, HttpStatus, Post, UnauthorizedException, UseGuards } from "@nestjs/common";
import { AuthService } from "./auth.service";
import { LoginDto } from "./dto/login.dto";
import { RefreshDto } from "./dto/refresh.dto";
import { JwtAuthGuard } from "./jwt-auth.guard";
import { CurrentUser } from "./current-user.decorator";
import type { RequestUser } from "./jwt.strategy";
import { UserService } from "../identity/users/user.service";

@Controller("auth")
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly userService: UserService,
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

  @Get("me")
  @UseGuards(JwtAuthGuard)
  async me(@CurrentUser() currentUser: RequestUser) {
    const user = await this.userService.findById(currentUser.id);
    if (!user) throw new UnauthorizedException();

    return {
      id: user.id,
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
      roles: user.roles.filter((r) => r.isActive).map((r) => r.role),
      assignmentTypes: await this.authService.activeAssignmentTypes(user.id),
    };
  }
}
