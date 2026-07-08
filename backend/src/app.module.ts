import { Module } from "@nestjs/common";
import { PlatformModule } from "./platform/platform.module";
import { AuthModule } from "./modules/auth";
import { CbtModule } from "./modules/cbt";
import { CoursesModule } from "./modules/courses";
import { CredentialsModule } from "./modules/credentials";
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
    CoursesModule,
    CbtModule,
    CredentialsModule,
  ],
})
export class AppModule {}
