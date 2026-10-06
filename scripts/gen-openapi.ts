import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import {
  buildOpenApiDocument,
  serializeOpenApiDocument,
} from "../src/lib/api/openapi.ts";

const target = join(import.meta.dir, "..", "docs", "openapi.json");
mkdirSync(dirname(target), { recursive: true });
writeFileSync(target, serializeOpenApiDocument(buildOpenApiDocument()));
console.log(`wrote ${target}`);
