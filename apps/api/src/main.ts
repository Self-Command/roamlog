import "reflect-metadata";

import { runApiProcess } from "./bootstrap/run-api.js";

// The process guards are installed inside `runApiProcess` before any Nest code
// runs, so even a rejection during startup is logged and exits with a code.
void runApiProcess();