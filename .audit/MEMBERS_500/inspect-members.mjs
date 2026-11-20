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
if (!pg) {
  console.error("pg module not resolvable");
  process.exit(2);
}

const WS = process.argv[2] ?? "019b7946-1c12-72e5-b2f5-ba152dee90d6";
const client = new pg.Client({
  connectionString: "postgresql://postgres@127.0.0.1:55444/roamlog_local?schema=public",
});
await client.connect();

const ws = await client.query(
  `select id, name, slug, "ownerId", status, "deletedAt" from "Workspace" where id = $1 or slug in ('roamlog-crew','travel-archive-2f2fa4e4fda6')`,
  [WS],
);
console.log("WORKSPACES:", JSON.stringify(ws.rows, null, 2));

const members = await client.query(
  `select m.id, m."workspaceId", m."userId", m.role, m.status, m."joinedAt", m."invitedById",
          m."createdAt", m."updatedAt",
          u.email, u."emailVerified", u.name, u.image, u."platformRole", u.status as "userStatus",
          u.locale, u.timezone, u."lastActiveAt",
          u."createdAt" as "uCreatedAt", u."updatedAt" as "uUpdatedAt", u."deletedAt" as "uDeletedAt",
          u.id as "userIdJoined"
     from "WorkspaceMember" m
     left join "User" u on u.id = m."userId"
    where m."workspaceId" = $1
    order by m."joinedAt" asc, m.id asc`,
  [WS],
);
console.log("MEMBER COUNT:", members.rows.length);
for (const r of members.rows) {
  console.log(JSON.stringify(r));
  for (const [k, v] of Object.entries(r)) {
    if (v === null) console.log(`  NULL: ${k}`);
  }
}

const anomalies = await client.query(
  `select id, email, name, image, locale, timezone, status, "platformRole"
     from "User"
    where image is not null and image !~* '^[a-z][a-z0-9+.-]*://'
   union all
   select id, email, name, image, locale, timezone, status, "platformRole"
     from "User" where name is null or btrim(name) = ''`,
);
console.log("GLOBAL ANOMALOUS USERS:", JSON.stringify(anomalies.rows, null, 2));

await client.end();