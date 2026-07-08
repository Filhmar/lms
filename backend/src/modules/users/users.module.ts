import { Module } from "@nestjs/common";
import { AuthModule } from "../auth";
import { OrgHierarchyModule } from "../org-hierarchy";
import { ScopeStatsController } from "./scope-stats.controller";
import { UsersController } from "./users.controller";
import { UsersRepository } from "./users.repository";
import { UsersService } from "./users.service";

@Module({
  imports: [AuthModule, OrgHierarchyModule],
  controllers: [UsersController, ScopeStatsController],
  providers: [UsersService, UsersRepository],
})
export class UsersModule {}
