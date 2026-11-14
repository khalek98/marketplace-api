import { Body, Controller, Headers, HttpCode, Param, Post, Req, Res, UseGuards } from "@nestjs/common";
import { Response } from "express";

import { ApplicationError } from "../common/errors/application-error";
import { AccessTokenGuard, RequestWithPrincipal } from "../auth/access-token.guard";
import { CommitBody, IntentBody, IntentRequest } from "./uploads.types";
import { UploadsService } from "./uploads.service";

@Controller("uploads")
@UseGuards(AccessTokenGuard)
export class UploadsController {
  constructor(private readonly uploads: UploadsService) {}

  @Post("intent")
  @HttpCode(200)
  async intent(
    @Headers("Idempotency-Key") idempotencyKey: string | undefined,
    @Body() body: IntentRequest,
    @Req() req: RequestWithPrincipal,
    @Res({ passthrough: true }) res: Response,
  ): Promise<IntentBody> {
    const result = await this.uploads.intent(ownerId(req), idempotencyKey, body ?? {});
    if (result.replay) res.setHeader("Idempotency-Replay", "true");
    return result.body;
  }

  @Post(":id/commit")
  @HttpCode(200)
  commit(@Param("id") id: string, @Req() req: RequestWithPrincipal): Promise<CommitBody> {
    return this.uploads.commit(ownerId(req), id);
  }
}

function ownerId(req: RequestWithPrincipal): string {
  const id = req.principal?.sub;
  if (!id) {
    throw new ApplicationError(
      401,
      "Invalid access token",
      "A valid Bearer access token is required.",
      "invalid-access-token",
    );
  }
  return id;
}
