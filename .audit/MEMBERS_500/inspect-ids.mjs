import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
let pg;
for (const c of [
  "C:/Users/BY9700/Desktop/UI/roamlog/node_modules/pg",
  "C:/Users/BY9700/Desktop/UI/roamlog/node_modules/.pnpm/pg@8.23.1/node_modules/pg",
]) {
  try {
    pg = require(c);
    break;
  } catch {
    /* next */
  }
}
const client = new pg.Client({
  connectionString: "postgresql://postgres@127.0.0.1:55444/roamlog_local?schema=public",
});
await client.connect();

const dflt = await client.query(
  `select table_name, column_name, column_default
     from information_schema.columns
    where (table_name, column_name) in (('WorkspaceMember','id'),('User','id'),('Workspace','id'),('AuditLog','id'))
    order by 1,2`,
);
console.log("DEFAULTS:", JSON.stringify(dflt.rows, null, 2));

const memberVersions = await client.query(
  `select substr(id::text, 15, 1) as version_nibble, count(*)::int as n
     from "WorkspaceMember" group by 1 order by 1`,
);
console.log("MEMBER ID VERSIONS:", JSON.stringify(memberVersions.rows));

const userVersions = await client.query(
  `select substr(id::text, 15, 1) as version_nibble, count(*)::int as n
     from "User" group by 1 order by 1`,
);
console.log("USER ID VERSIONS:", JSON.stringify(userVersions.rows));

const badMembers = await client.query(
  `select m.id::text, m."workspaceId"::text, w.slug, m."userId"::text, m.role, m."createdAt"
     from "WorkspaceMember" m join "Workspace" w on w.id = m."workspaceId"
    where substr(m.id::text, 15, 1) <> '7'
    order by m."createdAt"`,
);
console.log("NON-V7 MEMBERS:", JSON.stringify(badMembers.rows, null, 2));

const auditish = await client.query(
  `select action, "targetType", count(*)::int as n
     from "AuditLog"
    where "targetType" = 'member' or action like 'member%' or action like 'workspace%'
    group by 1,2 order by 3 desc limit 20`,
);
console.log("MEMBER/WORKSPACE AUDIT ACTIONS:", JSON.stringify(auditish.rows, null, 2));

const recentAudit = await client.query(
  `select "createdAt", action, "targetType", "targetId"::text, metadata
     from "AuditLog"
    where "workspaceId" = '019b7946-1c12-72e5-b2f5-ba152dee90d6'
      and ("targetType" = 'member' or action like '%member%' or action like '%invitation%')
    order by "createdAt" desc limit 12`,
);
console.log("RECENT WS AUDIT:", JSON.stringify(recentAudit.rows, null, 2));

await client.end();