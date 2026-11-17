import { runMinioSmoke } from "../../apps/worker/src/tools/minio-smoke.js";

runMinioSmoke()
  .then((result) => {
    console.log(JSON.stringify({ status: "ok", ...result }, null, 2));
  })
  .catch((error: unknown) => {
    console.error(
      JSON.stringify(
        {
          status: "failed",
          error: error instanceof Error ? error.message : String(error),
        },
        null,
        2,
      ),
    );
    process.exitCode = 1;
  });
