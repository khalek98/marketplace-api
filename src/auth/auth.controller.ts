import { Body, Controller, Get, HttpCode, Post, Req, UseGuards } from "@nestjs/common";

import { AccessTokenGuard, RequestWithPrincipal } from "./access-token.guard";
import { AuthService } from "./auth.service";

type LoginBody = {
  email: string;
  password: string;
};

type RefreshBody = {
  refresh_token: string;
};

@Controller("auth")
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Post("login")
  @HttpCode(200)
  login(@Body() body: LoginBody) {
    return this.auth.login(body.email, body.password);
  }

  @Post("refresh")
  @HttpCode(200)
  refresh(@Body() body: RefreshBody) {
    return this.auth.refresh(body.refresh_token);
  }

  @Post("logout")
  @HttpCode(204)
  @UseGuards(AccessTokenGuard)
  logout(@Req() req: RequestWithPrincipal): Promise<void> {
    return this.auth.logout(req.principal!);
  }

  @Get("me")
  @UseGuards(AccessTokenGuard)
  me(@Req() req: RequestWithPrincipal) {
    return { id: req.principal!.sub, role: req.principal!.role };
  }
}
