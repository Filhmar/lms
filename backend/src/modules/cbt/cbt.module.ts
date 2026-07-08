import { Module } from "@nestjs/common";
import { AuthModule } from "../auth";
import { CoursesModule } from "../courses";
import { CredentialsModule } from "../credentials";
import { OrgHierarchyModule } from "../org-hierarchy";
import { AttemptsController } from "./attempts.controller";
import { CbtRepository } from "./cbt.repository";
import { CbtService } from "./cbt.service";
import { ExamsController } from "./exams.controller";
import { GradingProcessor } from "./grading.processor";
import { GradingQueue } from "./grading.queue";
import { DbKeyProvider, KEY_PROVIDER } from "./key-provider";
import { SyncController } from "./sync.controller";

@Module({
  // CoursesModule provides the "progress" leg of POST /sync/batch;
  // CredentialsModule provides the badge-issuance seam for the grading worker.
  imports: [AuthModule, OrgHierarchyModule, CoursesModule, CredentialsModule],
  controllers: [ExamsController, SyncController, AttemptsController],
  providers: [
    CbtService,
    CbtRepository,
    GradingQueue,
    GradingProcessor,
    // Swap for a KMS-backed provider before production (see key-provider.ts).
    { provide: KEY_PROVIDER, useClass: DbKeyProvider },
  ],
})
export class CbtModule {}
