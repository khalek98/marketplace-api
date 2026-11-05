import { Module } from "@nestjs/common";

import { AccessTokenGuard } from "./access-token.guard";
import { AuthController } from "./auth.controller";
import { AuthService } from "./auth.service";
import { Denylist } from "./denylist";
import { RolesGuard } from "./roles.guard";
import { SigningKeysService } from "./signing-keys.service";

@Module({
  controllers: [AuthController],
  providers: [AuthService, SigningKeysService, Denylist, AccessTokenGuard, RolesGuard],
  exports: [SigningKeysService, Denylist, AccessTokenGuard, RolesGuard],
})
export class AuthModule {}
