import { Module } from "@nestjs/common";

import { AuthModule } from "../auth/auth.module";
import { FilesController } from "./files.controller";
import { UploadsController } from "./uploads.controller";
import { UploadsService } from "./uploads.service";

@Module({
  imports: [AuthModule],
  controllers: [UploadsController, FilesController],
  providers: [UploadsService],
})
export class UploadsModule {}
