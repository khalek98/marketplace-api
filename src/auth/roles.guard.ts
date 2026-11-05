import { CanActivate, ExecutionContext, Injectable, SetMetadata } from "@nestjs/common";
import { Reflector } from "@nestjs/core";

import { ApplicationError } from "../common/errors/application-error";
import { RequestWithPrincipal } from "./access-token.guard";

export const ROLES_KEY = "roles";

/** Roles allowed to call this handler. Checked only after the access token is valid. */
export const Roles = (...roles: string[]) => SetMetadata(ROLES_KEY, roles);

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const allowed = this.reflector.get<string[]>(ROLES_KEY, context.getHandler());
    if (!allowed?.length) return true;

    const role = context.switchToHttp().getRequest<RequestWithPrincipal>().principal?.role;
    if (!role || !allowed.includes(role)) {
      throw new ApplicationError(403, "Forbidden", "This action is not allowed for this role.", "role-denied");
    }
    return true;
  }
}
