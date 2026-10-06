import { spawnSync } from "node:child_process";

export default function setup() {
  const result = spawnSync("bun", ["scripts/i18n-compile.ts"], {
    stdio: "inherit",
  });
  if (result.status !== 0) throw new Error("paraglide compile failed");
}
