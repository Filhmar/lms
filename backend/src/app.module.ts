import { Module } from "@nestjs/common";
import { PlatformModule } from "./platform/platform.module";
import { AuthModule } from "./modules/auth";
import { OrgHierarchyModule } from "./modules/org-hierarchy";
import { ProvisioningModule } from "./modules/provisioning";

@Module({
  imports: [PlatformModule, AuthModule, OrgHierarchyModule, ProvisioningModule],
})
export class AppModule {}
