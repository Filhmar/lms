import { Module } from "@nestjs/common";
import { PlatformModule } from "./platform/platform.module";
import { AuthModule } from "./modules/auth";
import { CbtModule } from "./modules/cbt";
import { OrgHierarchyModule } from "./modules/org-hierarchy";
import { ProvisioningModule } from "./modules/provisioning";
import { UsersModule } from "./modules/users";

@Module({
  imports: [
    PlatformModule,
    AuthModule,
    OrgHierarchyModule,
    ProvisioningModule,
    UsersModule,
    CbtModule,
  ],
})
export class AppModule {}
