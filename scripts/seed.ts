import { readFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { ApiError } from "../src/lib/api/errors.ts";
import { createApiClient } from "../src/lib/api/client.ts";
import { seedSchema } from "../src/lib/api/schemas/seed.ts";
import { importSeed, SeedError } from "../src/lib/server/seed/import.ts";

const USAGE = `Usage: bun scripts/seed.ts --file <seed.json> [--url <http://host:3000>] [--token <hw_...>] [--update]

Imports rooms, assets (with the details of vehicles), tasks and preparations
through the REST API. Safe to run again: entries are found by their key and
left alone (use --update to overwrite them). The token needs the read and write
scopes (create one under Settings > API tokens, kind "integration"). Defaults:
HAUSWART_URL (else http://localhost:3000) and HAUSWART_TOKEN.`;

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

const { values } = parseArgs({
  options: {
    file: { type: "string" },
    url: { type: "string" },
    token: { type: "string" },
    update: { type: "boolean", default: false },
    help: { type: "boolean", default: false },
  },
});
if (values.help) {
  console.log(USAGE);
  process.exit(0);
}
if (!values.file) fail(`--file is required\n\n${USAGE}`);
const token = values.token ?? process.env.HAUSWART_TOKEN;
if (!token) fail("A token is required: --token or HAUSWART_TOKEN");
const baseUrl =
  values.url ?? process.env.HAUSWART_URL ?? "http://localhost:3000";

let json: unknown;
try {
  json = JSON.parse(readFileSync(values.file, "utf8"));
} catch (err) {
  fail(
    `Cannot read ${values.file}: ${err instanceof Error ? err.message : "unknown error"}`,
  );
}
const parsed = seedSchema.safeParse(json);
if (!parsed.success) {
  // Paths and messages only: the values in the file may be private.
  const lines = parsed.error.issues.map(
    (issue) => `  ${issue.path.join(".") || "(root)"}: ${issue.message}`,
  );
  fail(`${values.file} is not a valid seed file:\n${lines.join("\n")}`);
}

try {
  const report = await importSeed(
    createApiClient(fetch, baseUrl, { token }),
    parsed.data,
    { update: values.update, log: (line) => console.log(line) },
  );
  console.log(JSON.stringify(report, null, 2));
} catch (err) {
  if (err instanceof ApiError) {
    fail(`The server answered ${err.status} ${err.code}: ${err.message}`);
  }
  if (err instanceof SeedError) fail(err.message);
  throw err;
}
