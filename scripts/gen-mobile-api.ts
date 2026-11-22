import {
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import {
  generateMobileApi,
  type OpenApiDoc,
} from "../mobile/api-generator/generate.ts";

const root = join(import.meta.dir, "..");
const target = join(
  root,
  "mobile/shared/src/commonMain/kotlin/ch/orellbuehler/hauswart/api/generated",
);
const doc = JSON.parse(
  readFileSync(join(root, "docs/openapi.json"), "utf8"),
) as OpenApiDoc;
const files = generateMobileApi(doc);
mkdirSync(target, { recursive: true });
for (const name of readdirSync(target))
  if (!files.has(name)) rmSync(join(target, name));
for (const [name, content] of files) writeFileSync(join(target, name), content);
console.log(`wrote ${files.size} files to ${target}`);
