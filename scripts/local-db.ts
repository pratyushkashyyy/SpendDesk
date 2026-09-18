import EmbeddedPostgres from "embedded-postgres";
import { mkdir, readFile, writeFile, access } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import { resolve } from "node:path";
import { spawn } from "node:child_process";
import { refreshIntervalMinutes } from "../lib/schedule";

const directory = resolve(".local");
await mkdir(directory, { recursive: true });
const settingsPath = resolve(directory, "config.json");
let settings: Record<string, string>;
try {
  settings = JSON.parse(await readFile(settingsPath, "utf8"));
} catch {
  settings = Object.fromEntries(
    ["DB_PASSWORD", "ENCRYPTION_KEY", "SESSION_SECRET", "SETUP_TOKEN"].map(
      (k) => [k, randomBytes(32).toString("hex")],
    ),
  );
  await writeFile(settingsPath, JSON.stringify(settings), { mode: 0o600 });
}
const env = {
  DATABASE_URL: `postgresql://storedesk:${settings.DB_PASSWORD}@127.0.0.1:55432/storedesk`,
  APP_URL: "http://127.0.0.1:3000",
  ENCRYPTION_KEY: settings.ENCRYPTION_KEY,
  SESSION_SECRET: settings.SESSION_SECRET,
  SETUP_TOKEN: settings.SETUP_TOKEN,
  LOCAL_DEV_AUTH: "false",
  GOOGLE_ADS_API_VERSION: "v25",
  SHOPIFY_API_VERSION: "2026-07",
};
// Local environment is isolated from Railway; running this setup never contacts Railway.
await writeFile(
  ".env.local",
  Object.entries(env)
    .map(([k, v]) => `${k}=${v}`)
    .join("\n") + "\n",
  { mode: 0o600 },
);
const databaseDir = resolve(directory, "postgres");
const pg = new EmbeddedPostgres({
  databaseDir,
  user: "storedesk",
  password: settings.DB_PASSWORD,
  port: 55432,
  persistent: true,
  postgresFlags: ["-h", "127.0.0.1"],
  onLog: () => {},
  onError: (message) => console.error(message),
});
try {
  await access(resolve(databaseDir, "PG_VERSION"));
} catch {
  await pg.initialise();
}
await pg.start();
const client = pg.getPgClient();
await client.connect();
const existing = await client.query(
  "SELECT datname FROM pg_database WHERE datname='storedesk'",
);
await client.end();
if (!existing.rows.length) await pg.createDatabase("storedesk");
await new Promise<void>((resolve, reject) => {
  const child = spawn(
    process.execPath,
    ["--env-file=.env.local", "--import", "tsx", "scripts/migrate.ts"],
    { stdio: "inherit" },
  );
  child.on("exit", (code) =>
    code === 0 ? resolve() : reject(new Error("Migration failed.")),
  );
});
console.log(
  "Local PostgreSQL ready on 127.0.0.1:55432. Start the app with npm run dev.",
);
if (process.argv.includes("--open-setup")) {
  spawn("open", [`http://127.0.0.1:3000/setup#${settings.SETUP_TOKEN}`], {
    stdio: "ignore",
  });
  console.log("Private local setup link opened.");
}
let app: ReturnType<typeof spawn> | undefined;
let sync: ReturnType<typeof spawn> | undefined;
let timer: ReturnType<typeof setInterval> | undefined;
if (process.argv.includes("--app")) {
  app = spawn(
    process.execPath,
    ["node_modules/next/dist/bin/next", "dev", "--hostname", "127.0.0.1"],
    { stdio: "inherit" },
  );
  let lastRefresh = Date.now();
  let checking = false;
  const refresh = async () => {
    if (sync || checking) return;
    checking = true;
    // Each four-day Ads refresh uses about 20 search operations per store.
    // Reserve headroom beneath Explorer's 2,880-operation daily allowance.
    const schedulerClient = pg.getPgClient("storedesk", "127.0.0.1");
    try {
      await schedulerClient.connect();
      const result = await schedulerClient.query(
        "SELECT count(*)::int AS count FROM stores",
      );
      const minutes = refreshIntervalMinutes(result.rows[0].count);
      if (Date.now() - lastRefresh < minutes * 60 * 1000) return;
      lastRefresh = Date.now();
    } catch {
      console.error("Local scheduler could not check its refresh allowance.");
      return;
    } finally {
      await schedulerClient.end();
      checking = false;
    }
    sync = spawn(
      process.execPath,
      ["--env-file=.env.local", "--import", "tsx", "scripts/sync.ts"],
      { stdio: "inherit" },
    );
    sync.on("exit", () => {
      sync = undefined;
    });
  };
  timer = setInterval(refresh, 15 * 60 * 1000);
  console.log("Local app and Explorer-aware sync scheduler started.");
  app.on("exit", () => {
    void stop();
  });
}
let stopping = false;
async function stop() {
  if (stopping) return;
  stopping = true;
  if (timer) clearInterval(timer);
  app?.kill("SIGTERM");
  sync?.kill("SIGTERM");
  await pg.stop();
  process.exit(0);
}
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
await new Promise(() => {});
