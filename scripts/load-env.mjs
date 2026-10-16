import { existsSync } from "node:fs";
// Railway supplies environment variables directly. Local development may use a
// file, but its absence in production should not emit a misleading error log.
if (existsSync(".env.local")) process.loadEnvFile(".env.local");
