import { Controller, Get, Param, Req, Res, UseGuards } from "@nestjs/common";
import { Response } from "express";

import { ApplicationError } from "../common/errors/application-error";
import { AccessTokenGuard, RequestWithPrincipal } from "../auth/access-token.guard";
import { UploadsService } from "./uploads.service";

@Controller("files")
@UseGuards(AccessTokenGuard)
export class FilesController {
  constructor(private readonly uploads: UploadsService) {}

  @Get(":id")
  async open(@Param("id") id: string, @Req() req: RequestWithPrincipal, @Res() res: Response): Promise<void> {
    const url = await this.uploads.presignRead(ownerId(req), id);
    res.writeHead(302, { location: url });
    res.end();
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
