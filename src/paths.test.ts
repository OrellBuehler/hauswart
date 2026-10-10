import { describe, expect, it } from "vitest";
import config from "../svelte.config.js";

describe("asset paths", () => {
  it("are absolute: the offline page is precached once and served in place of any app page", () => {
    // SvelteKit's default (`paths.relative: true`) renders `./_app/...` links. The service worker
    // answers a failed navigation to /tasks/12 or /d/<slug> with the precached /offline, whose
    // stylesheet would then resolve to /tasks/_app/... and 404: an unstyled page.
    expect(config.kit?.paths?.relative).toBe(false);
  });
});
