import { Module } from "@nestjs/common";
import { AuthModule } from "../auth";
import { OrgHierarchyController } from "./org-hierarchy.controller";
import { OrgHierarchyRepository } from "./org-hierarchy.repository";
import { OrgHierarchyService } from "./org-hierarchy.service";
import { ScopeAccessService } from "./scope-access.service";
import { ScopeGuard } from "./scope.guard";

@Module({
  imports: [AuthModule],
  controllers: [OrgHierarchyController],
  providers: [
    OrgHierarchyService,
    OrgHierarchyRepository,
    ScopeAccessService,
    ScopeGuard,
  ],
  exports: [OrgHierarchyService, ScopeAccessService, ScopeGuard],
})
export class OrgHierarchyModule {}
