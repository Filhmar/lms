import { Module } from "@nestjs/common";
import { AuthModule } from "../auth";
import { OrgHierarchyModule } from "../org-hierarchy";
import { ProvisioningController } from "./provisioning.controller";
import { ProvisioningProcessor } from "./provisioning.processor";
import { ProvisioningQueue } from "./provisioning.queue";
import { ProvisioningRepository } from "./provisioning.repository";
import { ProvisioningService } from "./provisioning.service";

@Module({
  imports: [AuthModule, OrgHierarchyModule],
  controllers: [ProvisioningController],
  providers: [
    ProvisioningService,
    ProvisioningRepository,
    ProvisioningQueue,
    ProvisioningProcessor,
  ],
})
export class ProvisioningModule {}
