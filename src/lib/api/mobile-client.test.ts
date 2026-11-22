import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  generateMobileApi,
  type OpenApiDoc,
} from "../../../mobile/api-generator/generate.ts";
import { buildOpenApiDocument } from "./openapi";

const target = join(
  process.cwd(),
  "mobile/shared/src/commonMain/kotlin/ch/orellbuehler/hauswart/api/generated",
);
const files = generateMobileApi(
  JSON.parse(JSON.stringify(buildOpenApiDocument())) as OpenApiDoc,
);

describe("the mobile apps' Kotlin client", () => {
  it("is up to date: run `bun run mobile:api` after changing the registry", () => {
    for (const [name, content] of files) {
      const path = join(target, name);
      expect(existsSync(path), name).toBe(true);
      expect(readFileSync(path, "utf8"), name).toBe(content);
    }
    expect(readdirSync(target).sort()).toEqual([...files.keys()].sort());
  });

  it("leaves out what a device token cannot call", () => {
    const all = [...files.values()].join("\n");
    expect(all).toContain("suspend fun tasksList(");
    expect(all).toContain("suspend fun authToken(");
    expect(all).not.toContain("suspend fun authChangePassword(");
    expect(all).not.toContain("suspend fun tokensCreate(");
  });

  it("turns a union with a constant type into a sealed class with a fallback", () => {
    const models = files.get("Models.kt") ?? "";
    expect(models).toContain("sealed class Trigger {");
    expect(models).toContain('@SerialName("interval")');
    expect(models).toContain("data object Unknown : Trigger()");
    expect(files.get("HauswartApi.kt")).toContain(
      "polymorphicDefaultDeserializer(Trigger::class)",
    );
  });

  it("makes nullable fields of an update a Patch", () => {
    const tasks = files.get("TasksApi.kt") ?? "";
    expect(tasks).toMatch(/val assetId: Patch<String> = Patch\.Keep/);
    expect(tasks).toMatch(/val title: String\? = null/);
  });
});
