import { CanActivate, ExecutionContext, Injectable } from "@nestjs/common";
import type { Request } from "express";

import { ApplicationError } from "../common/errors/application-error";
import { verifyAccessToken } from "./tokens";
import { SigningKeysService } from "./signing-keys.service";

export type AccessPrincipal = {
  sub: string;
  role: string;
  jti: string;
  exp: number;
};

export type RequestWithPrincipal = Request & { principal?: AccessPrincipal };

@Injectable()
export class AccessTokenGuard implements CanActivate {
  constructor(private readonly signing: SigningKeysService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<RequestWithPrincipal>();
    const header = req.headers.authorization;
    const token = bearerToken(header);
    if (!token) {
      throw unauthorized();
    }

    const keys = this.signing.material();
    try {
      req.principal = await verifyAccessToken(keys, token);
    } catch {
      throw unauthorized();
    }
    return true;
  }
}

function bearerToken(header: string | undefined): string | undefined {
  if (!header?.startsWith("Bearer ")) return undefined;
  const token = header.slice("Bearer ".length);
  if (!token || /\s/.test(token)) return undefined;
  return token;
}

function unauthorized(): ApplicationError {
  return new ApplicationError(
    401,
    "Invalid access token",
    "A valid Bearer access token is required.",
    "invalid-access-token",
  );
}
