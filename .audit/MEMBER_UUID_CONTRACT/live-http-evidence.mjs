import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const pg = require(
  fileURLToPath(new URL("../../node_modules/.pnpm/pg@8.23.1/node_modules/pg", import.meta.url)),
);

const API = process.env.API_BASE ?? "http://127.0.0.1:4100";
const ORIGIN = "http://localhost:3000";
const LOCAL_DB = "postgresql://postgres@127.0.0.1:55444/roamlog_local";
const CI_DB = "postgresql://postgres@127.0.0.1:55444/roamlog_ci";
const PASSWORD = "Roamlog-Verify-Aa1!";

/**
 * Deterministic UUIDv7 ids for the live fixture. Nothing here is minted with
 * `randomUUID()`: four rows are created as v7 and exactly two of them are then
 * rewritten to the v4 ids that actually broke `GET /members` in `roamlog-crew`.
 */
const ownerUserId = "01942f30-1200-7000-8000-000000009001";
const editorUserId = "01942f30-1200-7000-8000-000000009002";
const patchUserId = "01942f30-1200-7000-8000-000000009003";
const removeUserId = "01942f30-1200-7000-8000-000000009004";
const workspaceId = "01942f30-1200-7000-8000-000000009101";
const ownerMemberId = "01942f30-1200-7000-8000-000000009201";
const editorMemberId = "01942f30-1200-7000-8000-000000009202";
const patchMemberV7 = "01942f30-1200-7000-8000-000000009203";
const removeMemberV7 = "01942f30-1200-7000-8000-000000009204";
const legacyPatchMemberId = "83a7562c-4032-4de0-a33b-5ddc63b292ab";
const legacyRemoveMemberId = "e7aa8557-6e54-45f8-b8cf-b2735314cdce";
const ownerEmail = "uuid-contract-owner@roamlog.test";
const editorEmail = "uuid-contract-editor@roamlog.test";
const userIds = [ownerUserId, editorUserId, patchUserId, removeUserId];

const local = new pg.Client({ connectionString: LOCAL_DB });
const ci = new pg.Client({ connectionString: CI_DB });

function line(label) {
  console.log(`\n${"=".repeat(6)} ${label} ${"=".repeat(6)}`);
}

async function inTransaction(work) {
  // `Workspace_owner_membership_check` / `WorkspaceMember_owner_membership_check`
  // are DEFERRABLE INITIALLY DEFERRED, so workspace + owner membership (or their
  // deletions) must commit together.
  await ci.query("begin");
  try {
    await work();
    await ci.query("commit");
  } catch (error) {
    await ci.query("rollback");
    throw error;
  }
}

async function cleanup() {
  await ci.query(`delete from "AuditLog" where "workspaceId" = $1`, [workspaceId]);
  await inTransaction(async () => {
    await ci.query(
      `delete from "WorkspaceMember" where "workspaceId" = $1 or id in ($2::uuid, $3::uuid)`,
      [workspaceId, legacyPatchMemberId, legacyRemoveMemberId],
    );
    await ci.query(`delete from "Workspace" where id = $1`, [workspaceId]);
  });
  await ci.query(`delete from "Session" where "userId" = any($1::uuid[])`, [userIds]);
  await ci.query(`delete from "Account" where "userId" = any($1::uuid[])`, [userIds]);
  await ci.query(`delete from "User" where id = any($1::uuid[])`, [userIds]);
}

async function signIn(email) {
  const response = await fetch(`${API}/v1/auth/sign-in/email`, {
    method: "POST",
    headers: { "content-type": "application/json", origin: ORIGIN },
    body: JSON.stringify({ email, password: PASSWORD }),
  });
  const cookies = response.headers.getSetCookie().map((cookie) => cookie.split(";")[0]);
  if (response.status !== 200 || cookies.length === 0) {
    throw new Error(`sign-in ${email} -> ${response.status} ${await response.text()}`);
  }
  return cookies.join("; ");
}

async function call(method, path, cookie, body) {
  const response = await fetch(API + path, {
    method,
    headers: {
      cookie,
      origin: ORIGIN,
      accept: "application/json",
      ...(body ? { "content-type": "application/json" } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const text = await response.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    json = text;
  }
  return { status: response.status, json };
}

await local.connect();
await ci.connect();

const credential = await local.query(
  `select a.password from "Account" a join "User" u on u.id = a."userId"
    where u.email = 'verify@roamlog.test' and a."providerId" = 'credential'`,
);
const passwordHash = credential.rows[0]?.password;
if (!passwordHash) {
  throw new Error("could not read a credential password hash from roamlog_local");
}

await cleanup();

line("seed: Prisma-shaped v7 rows in roamlog_ci");
await ci.query(
  `insert into "User" (id, email, "emailVerified", name, locale, timezone, "createdAt", "updatedAt")
   values ($1::uuid, $2, true, 'UUID Contract Owner', 'zh-CN', 'Asia/Shanghai', now(), now()),
          ($3::uuid, $4, true, 'UUID Contract Editor', 'zh-CN', 'Asia/Shanghai', now(), now()),
          ($5::uuid, 'uuid-contract-patch@roamlog.test', true, 'UUID Contract Patch', 'zh-CN', 'Asia/Shanghai', now(), now()),
          ($6::uuid, 'uuid-contract-remove@roamlog.test', true, 'UUID Contract Remove', 'zh-CN', 'Asia/Shanghai', now(), now())`,
  [ownerUserId, ownerEmail, editorUserId, editorEmail, patchUserId, removeUserId],
);
await ci.query(
  `insert into "Account" (id, "accountId", "providerId", "userId", password, "createdAt", "updatedAt")
   values ($1::uuid, $2::text, 'credential', $3::uuid, $5, now(), now()),
          ($4::uuid, $6::text, 'credential', $7::uuid, $5, now(), now())`,
  [
    "01942f30-1200-7000-8000-000000009301",
    ownerUserId,
    ownerUserId,
    "01942f30-1200-7000-8000-000000009302",
    passwordHash,
    editorUserId,
    editorUserId,
  ],
);
await inTransaction(async () => {
  await ci.query(
    `insert into "Workspace" (id, name, slug, "ownerId", "createdAt", "updatedAt")
     values ($1::uuid, 'UUID Contract Live', $2, $3::uuid, now(), now())`,
    [workspaceId, `uuid-contract-live-${workspaceId.slice(0, 8)}`, ownerUserId],
  );
  await ci.query(
    `insert into "WorkspaceMember" (id, "workspaceId", "userId", role, "joinedAt", "invitedById", "createdAt", "updatedAt")
     values ($1::uuid, $5::uuid, $2::uuid, 'owner', '2026-01-01T00:00:00Z', null, now(), now()),
            ($3::uuid, $5::uuid, $6::uuid, 'editor', '2026-01-02T00:00:00Z', $2::uuid, now(), now()),
            ($4::uuid, $5::uuid, $7::uuid, 'viewer', '2026-01-03T00:00:00Z', $2::uuid, now(), now()),
            ('01942f30-1200-7000-8000-000000009205'::uuid, $5::uuid, $8::uuid, 'viewer', '2026-01-04T00:00:00Z', $2::uuid, now(), now())`,
    [ownerMemberId, ownerUserId, editorMemberId, patchMemberV7, workspaceId, editorUserId, patchUserId, removeUserId],
  );
});
// The only non-v7 step: rewrite the two rows that stand in for the historical
// fixture rows written with `randomUUID()`.
await ci.query(`update "WorkspaceMember" set id = $1::uuid where id = $2::uuid`, [
  legacyPatchMemberId,
  patchMemberV7,
]);
await ci.query(`update "WorkspaceMember" set id = $1::uuid where id = $2::uuid`, [
  legacyRemoveMemberId,
  "01942f30-1200-7000-8000-000000009205",
]);
const seeded = await ci.query(
  `select id, role, "joinedAt" from "WorkspaceMember" where "workspaceId" = $1::uuid order by "joinedAt"`,
  [workspaceId],
);
console.log(seeded.rows.map((row) => `${row.id} ${row.role}`).join("\n"));

line("GET /v1/workspaces/:id/members (owner session)");
const ownerCookie = await signIn(ownerEmail);
const listed = await call("GET", `/v1/workspaces/${workspaceId}/members`, ownerCookie);
console.log(`status ${listed.status}`);
console.log(
  JSON.stringify({
    items: listed.json.items?.length,
    hasMore: listed.json.hasMore,
    members: listed.json.items?.map((item) => ({ id: item.id, role: item.role, userId: item.userId })),
  }),
);

line(`PATCH /v1/workspaces/:id/members/${legacyPatchMemberId}  { role: "editor" }`);
const patched = await call(
  "PATCH",
  `/v1/workspaces/${workspaceId}/members/${legacyPatchMemberId}`,
  ownerCookie,
  { role: "editor" },
);
console.log(`status ${patched.status}`);
console.log(JSON.stringify({ id: patched.json.id, role: patched.json.role, status: patched.json.status }));
const patchedRow = await ci.query(`select id, role from "WorkspaceMember" where id = $1::uuid`, [
  legacyPatchMemberId,
]);
console.log("db after PATCH:", JSON.stringify(patchedRow.rows));

line(`DELETE /v1/workspaces/:id/members/${legacyRemoveMemberId}`);
const removed = await call(
  "DELETE",
  `/v1/workspaces/${workspaceId}/members/${legacyRemoveMemberId}`,
  ownerCookie,
);
console.log(`status ${removed.status} ${JSON.stringify(removed.json)}`);
const removedRow = await ci.query(`select id from "WorkspaceMember" where id = $1::uuid`, [
  legacyRemoveMemberId,
]);
console.log("db after DELETE:", JSON.stringify(removedRow.rows));
const afterDelete = await call("GET", `/v1/workspaces/${workspaceId}/members`, ownerCookie);
console.log(
  `GET after DELETE: status ${afterDelete.status} items ${afterDelete.json.items?.length}`,
);

line("permission counter-proof: non-admin (editor) session");
const editorCookie = await signIn(editorEmail);
const forbiddenPatch = await call(
  "PATCH",
  `/v1/workspaces/${workspaceId}/members/${legacyPatchMemberId}`,
  editorCookie,
  { role: "viewer" },
);
console.log(`PATCH by editor -> ${forbiddenPatch.status} ${JSON.stringify(forbiddenPatch.json)}`);
const forbiddenDelete = await call(
  "DELETE",
  `/v1/workspaces/${workspaceId}/members/${legacyPatchMemberId}`,
  editorCookie,
);
console.log(`DELETE by editor -> ${forbiddenDelete.status} ${JSON.stringify(forbiddenDelete.json)}`);
const untouched = await ci.query(`select id, role from "WorkspaceMember" where id = $1::uuid`, [
  legacyPatchMemberId,
]);
console.log("db after forbidden calls:", JSON.stringify(untouched.rows));

line("format still enforced");
const hyphenless = await call(
  "PATCH",
  `/v1/workspaces/${workspaceId}/members/${legacyPatchMemberId.replaceAll("-", "")}`,
  ownerCookie,
  { role: "viewer" },
);
console.log(`PATCH hyphenless id -> ${hyphenless.status} ${JSON.stringify(hyphenless.json)}`);

line("cleanup");
await cleanup();
console.log("fixture rows removed");

await local.end();
await ci.end();