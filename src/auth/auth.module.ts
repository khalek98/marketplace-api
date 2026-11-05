import { Module } from "@nestjs/common";

import { AuthController } from "./auth.controller";
import { AuthService } from "./auth.service";
import { AccessTokenGuard } from "./access-token.guard";
import { SigningKeysService } from "./signing-keys.service";

@Module({
  controllers: [AuthController],
  providers: [AuthService, SigningKeysService, AccessTokenGuard],
  exports: [SigningKeysService, AccessTokenGuard],
})
export class AuthModule {}
