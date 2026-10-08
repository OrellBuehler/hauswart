import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import config from "../svelte.config.js";

const html = readFileSync("src/app.html", "utf8");
const layout = readFileSync("src/routes/+layout.svelte", "utf8");

describe("content security policy", () => {
  const csp = config.kit?.csp as {
    mode: string;
    directives: Record<string, string[]>;
  };

  it("lets SvelteKit nonce or hash its scripts and allows no inline scripts of our own", () => {
    expect(csp.mode).toBe("auto");
    expect(csp.directives["script-src"]).toEqual(["self"]);
  });

  it("restricts every other source as intended", () => {
    expect(csp.directives).toMatchObject({
      "default-src": ["self"],
      "img-src": ["self", "data:", "blob:"],
      "style-src": ["self", "unsafe-inline"],
      "worker-src": ["self"],
      "manifest-src": ["self"],
      "frame-ancestors": ["none"],
      "base-uri": ["self"],
      "form-action": ["self"],
      "object-src": ["none"],
    });
  });
});

describe("theme script in app.html", () => {
  const match = /<script nonce="%sveltekit\.nonce%">([\s\S]*?)<\/script>/.exec(
    html,
  );

  it("is the only inline script and carries the CSP nonce", () => {
    expect(match).not.toBeNull();
    expect(html.match(/<script/g)).toHaveLength(1);
    expect(layout).toContain("disableHeadScriptInjection");
  });

  function run(stored: string | null, prefersLight: boolean) {
    const classes = new Set<string>();
    const root = {
      classList: {
        toggle: (name: string, force: boolean) =>
          force ? classes.add(name) : classes.delete(name),
      },
      style: { colorScheme: "" },
    };
    new Function("document", "localStorage", "window", match![1]!)(
      { documentElement: root },
      {
        getItem: (key: string) => (key === "mode-watcher-mode" ? stored : null),
      },
      { matchMedia: () => ({ matches: prefersLight }) },
    );
    return { dark: classes.has("dark"), scheme: root.style.colorScheme };
  }

  it("applies the stored mode before first paint", () => {
    expect(run("dark", true)).toEqual({ dark: true, scheme: "dark" });
    expect(run("light", false)).toEqual({ dark: false, scheme: "light" });
  });

  it("follows the system preference by default", () => {
    expect(run(null, false)).toEqual({ dark: true, scheme: "dark" });
    expect(run(null, true)).toEqual({ dark: false, scheme: "light" });
    expect(run("system", true)).toEqual({ dark: false, scheme: "light" });
  });
});
