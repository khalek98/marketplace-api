import { Body, Controller, HttpCode, Post } from "@nestjs/common";

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
}
