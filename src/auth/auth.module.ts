import { Module } from "@nestjs/common";

import { AccessTokenGuard } from "./access-token.guard";
import { AuthController } from "./auth.controller";
import { AuthService } from "./auth.service";
import { Denylist } from "./denylist";
import { SigningKeysService } from "./signing-keys.service";

@Module({
  controllers: [AuthController],
  providers: [AuthService, SigningKeysService, Denylist, AccessTokenGuard],
  exports: [SigningKeysService, Denylist, AccessTokenGuard],
})
export class AuthModule {}
