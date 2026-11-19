import "../src/openapi/extend-zod";

import { OpenAPIRegistry, OpenApiGeneratorV31 } from "@asteasolutions/zod-to-openapi";
import { writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { registerAdminPaths } from "./openapi/paths-admin";
import { registerAuthPaths } from "./openapi/paths-auth";
import { registerContentPaths } from "./openapi/paths-content";
import { registerHealthPaths } from "./openapi/paths-health";
import { registerMediaPaths } from "./openapi/paths-media";
import { registerMoneyPaths } from "./openapi/paths-money";
import { registerPlacePaths } from "./openapi/paths-places";
import { registerSettingsPaths } from "./openapi/paths-settings";
import { registerSharingPaths } from "./openapi/paths-sharing";
import { registerTripPaths } from "./openapi/paths-trips";
import { registerWorkspacePaths } from "./openapi/paths-workspaces";
import { registerSchemas } from "./openapi/schemas";

export type OpenApiDocument = ReturnType<OpenApiGeneratorV31["generateDocument"]>;

export function buildOpenApiDocument(): OpenApiDocument {
  const registry = new OpenAPIRegistry();

  registerSchemas(registry);
  registry.registerComponent("securitySchemes", "cookieAuth", {
    type: "apiKey",
    in: "cookie",
    name: "better-auth.session_token",
    description:
      "httpOnly Better Auth session cookie. Browser clients must use same-origin or same-parent-domain requests.",
  });
  registerAuthPaths(registry);
  registerWorkspacePaths(registry);
  registerTripPaths(registry);
  registerContentPaths(registry);
  registerMediaPaths(registry);
  registerPlacePaths(registry);
  registerMoneyPaths(registry);
  registerSharingPaths(registry);
  registerAdminPaths(registry);
  registerSettingsPaths(registry);
  registerHealthPaths(registry);

  const generator = new OpenApiGeneratorV31(registry.definitions, {
    sortComponents: "alphabetically",
  });

  return generator.generateDocument({
    openapi: "3.1.0",
    info: {
      title: "Roamlog API",
      version: "1.0.0",
      description:
        "Contract-first API for Roamlog collaborative travel journals. All IDs are UUIDv7, business reads are Workspace-scoped, money uses integer minor units, and editable aggregates require optimistic versions.",
    },
    servers: [
      { url: "https://api.roamlog.app", description: "Production" },
      { url: "http://localhost:4000", description: "Local development" },
    ],
    tags: [
      { name: "Auth", description: "Better Auth handlers." },
      { name: "Me", description: "Current user, sessions, notifications, and account export." },
      { name: "Workspaces", description: "Tenant boundary and Workspace settings." },
      {
        name: "Members",
        description: "Workspace membership, roles, ownership, audit, and activity.",
      },
      { name: "Invitations", description: "Invite, revoke, and accept Workspace invitations." },
      { name: "Trips", description: "Trip planning, visibility, duplication, and activity." },
      {
        name: "Participants",
        description: "Trip participant subset used for sharing and assignment.",
      },
      { name: "Stops", description: "Geographic trip stops and ordering." },
      { name: "Itinerary", description: "Dated itinerary items and ordering." },
      { name: "Journal", description: "Journal entries, favorites, and revisions." },
      { name: "Comments", description: "Threaded comments, mentions, and resolution." },
      { name: "Media", description: "Direct uploads, media metadata, and trip covers." },
      { name: "Places", description: "Normalized place search for trip origins and stops." },
      {
        name: "Expenses",
        description: "Integer-minor-unit expense records and participant splits.",
      },
      { name: "Budget", description: "Multi-currency budget summaries and settle-up suggestions." },
      { name: "Packing", description: "Packing checklists and bulk updates." },
      {
        name: "Share Links",
        description: "Hashed public share links and the public read projection.",
      },
      { name: "Exports", description: "Asynchronous trip, Workspace, and account exports." },
      { name: "Search", description: "Workspace-scoped search." },
      { name: "Realtime", description: "Socket.IO namespace and typed cache-invalidation events." },
      { name: "Admin", description: "Independent platform administration API." },
      {
        name: "Settings",
        description: "Public site settings used by the web shell.",
      },
      { name: "Health", description: "Liveness and dependency readiness." },
    ],
    security: [{ cookieAuth: [] }],
  });
}

export function serializeOpenApiDocument(document: OpenApiDocument): string {
  return `${JSON.stringify(document, null, 2)}\n`;
}

const mainModule = process.argv[1] ? path.resolve(process.argv[1]) : "";
if (mainModule === fileURLToPath(import.meta.url)) {
  const target = fileURLToPath(new URL("../openapi.json", import.meta.url));
  const document = buildOpenApiDocument();
  writeFileSync(target, serializeOpenApiDocument(document), "utf8");
  console.log(
    `Wrote ${Object.keys(document.paths ?? {}).length} paths and ${
      Object.keys(document.components?.schemas ?? {}).length
    } schemas to ${path.relative(process.cwd(), target)}`,
  );
}
