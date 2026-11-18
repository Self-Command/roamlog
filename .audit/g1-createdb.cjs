// G1 helper: create the validation database on the embedded PostgreSQL.
// Usage: node .audit/g1-createdb.cjs <port> <database>
const path = require("node:path");

const port = Number(process.argv[2] || 55442);
const database = process.argv[3] || "roamlog_g1";

const { Client } = require(
  path.resolve(__dirname, "../packages/db/node_modules/pg"),
);

(async () => {
  const client = new Client({
    host: "127.0.0.1",
    port,
    user: "postgres",
    database: "postgres",
  });
  await client.connect();
  const existing = await client.query("SELECT 1 FROM pg_database WHERE datname = $1", [
    database,
  ]);
  if (existing.rowCount === 0) {
    await client.query(`CREATE DATABASE "${database}"`);
    console.log(`created ${database}`);
  } else {
    console.log(`${database} already exists`);
  }
  await client.end();
})().catch((error) => {
  console.error(error.message);
  process.exit(1);
});