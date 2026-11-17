import { SetMetadata } from "@nestjs/common";

export const CONTENT_TENANT_RESOURCE = "roamlog:content-tenant-resource";

export type ContentTenantResource = "trip" | "stop" | "itinerary" | "entry";

export function ContentTenant(resource: ContentTenantResource): MethodDecorator {
  return SetMetadata(CONTENT_TENANT_RESOURCE, resource);
}
