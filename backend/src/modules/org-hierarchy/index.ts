/**
 * PUBLIC CONTRACT of the org-hierarchy module.
 * Other modules may import from "../org-hierarchy" ONLY (module-public-index rule).
 */
export { OrgHierarchyModule } from "./org-hierarchy.module";
export { OrgHierarchyService } from "./org-hierarchy.service";
export { ScopeAccessService } from "./scope-access.service";
export { ScopeGuard, ScopeParam } from "./scope.guard";
