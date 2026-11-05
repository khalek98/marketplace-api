import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";

import { Env } from "../config/env.schema";
import { loadSigningKeys, SigningMaterial } from "../config/signing-keys";

/** Parsed once. main.ts already refuses to boot when these values are not a real ES256 pair. */
@Injectable()
export class SigningKeysService {
  private keys: SigningMaterial | undefined;

  constructor(private readonly config: ConfigService<Env, true>) {}

  material(): SigningMaterial {
    this.keys ??= loadSigningKeys({
      JWT_KID: this.config.get("JWT_KID", { infer: true }),
      JWT_PRIVATE_KEY: this.config.get("JWT_PRIVATE_KEY", { infer: true }),
      JWT_PUBLIC_KEY: this.config.get("JWT_PUBLIC_KEY", { infer: true }),
      REFRESH_TOKEN_PEPPER: this.config.get("REFRESH_TOKEN_PEPPER", { infer: true }),
    });
    return this.keys;
  }
}
