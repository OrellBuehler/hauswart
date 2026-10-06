import { Marked } from "marked";
import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import {
  MAX_MARKDOWN_BYTES,
  MAX_NESTING_DEPTH,
  MAX_SYNC_MARKDOWN_BYTES,
  MarkdownError,
  extractHeadings,
  extractHeadingsAsync,
  extractPlainText,
  extractPlainTextAsync,
  renderMarkdown,
  renderMarkdownAsync,
  type RenderMarkdownOptions,
} from "./markdown";
import { limitNesting } from "./markdown-core";
import { MAX_QUEUED_JOBS, shutdownMarkdownWorkers } from "./markdown-runner";

const guest: RenderMarkdownOptions = { audience: "guest" };
const member: RenderMarkdownOptions = { audience: "member" };
const FAST = { timeoutMs: 400 };

afterEach(() => vi.restoreAllMocks());
afterAll(() => shutdownMarkdownWorkers());

async function outcome(promise: Promise<unknown>) {
  const started = performance.now();
  try {
    await promise;
    return { code: "ok", ms: performance.now() - started };
  } catch (error) {
    if (!(error instanceof MarkdownError)) throw error;
    return { code: error.code, ms: performance.now() - started };
  }
}

/** Inputs that take marked seconds (quadratic) or overflow its stack, all within the size cap. */
const PATHOLOGICAL: Record<string, string> = {
  stars: "*a ".repeat(60_000),
  underscores: "_a ".repeat(60_000),
  doubleStars: "**a ".repeat(45_000),
  tildes: "~~a ".repeat(45_000),
  dashList: "- ".repeat(90_000) + "x",
  quotes: "> ".repeat(90_000) + "x",
};

describe("size limits", () => {
  it("exports the limits", () => {
    expect(MAX_MARKDOWN_BYTES).toBe(200 * 1024);
    expect(MAX_SYNC_MARKDOWN_BYTES).toBeLessThan(MAX_MARKDOWN_BYTES);
    expect(MAX_NESTING_DEPTH).toBe(20);
  });

  it("the synchronous functions reject anything above the sync cap", () => {
    const big = "a".repeat(MAX_SYNC_MARKDOWN_BYTES + 1);
    for (const run of [
      () => renderMarkdown(big, guest),
      () => extractPlainText(big),
      () => extractHeadings(big),
    ]) {
      expect(run).toThrowError(
        expect.objectContaining({ name: "MarkdownError", code: "too_large" }),
      );
    }
    expect(
      renderMarkdown("a".repeat(MAX_SYNC_MARKDOWN_BYTES), guest),
    ).toContain("<p>");
  });

  it("the async functions reject anything above the hard cap, counting bytes", async () => {
    const big = "a".repeat(MAX_MARKDOWN_BYTES + 1);
    expect((await outcome(renderMarkdownAsync(big, guest))).code).toBe(
      "too_large",
    );
    expect((await outcome(extractPlainTextAsync(big))).code).toBe("too_large");
    expect((await outcome(extractHeadingsAsync(big))).code).toBe("too_large");
    const multibyte = "ü".repeat(MAX_MARKDOWN_BYTES / 2 + 1);
    expect((await outcome(renderMarkdownAsync(multibyte, guest))).code).toBe(
      "too_large",
    );
    expect(
      (
        await outcome(
          renderMarkdownAsync("a".repeat(MAX_MARKDOWN_BYTES), guest),
        )
      ).code,
    ).not.toBe("too_large");
  });
});

describe("pathological input", () => {
  it.each(Object.entries(PATHOLOGICAL))(
    "%s completes or fails with a typed error within the time budget",
    async (_name, md) => {
      expect(md.length).toBeLessThanOrEqual(MAX_MARKDOWN_BYTES);
      for (const run of [
        () => renderMarkdownAsync(md, { ...guest, ...FAST }),
        () => extractPlainTextAsync(md, FAST),
        () => extractHeadingsAsync(md, FAST),
      ]) {
        const result = await outcome(run());
        expect(["ok", "too_complex"]).toContain(result.code);
        expect(result.ms).toBeLessThan(FAST.timeoutMs + 1500);
      }
    },
    20_000,
  );

  it("quadratic emphasis input times out with too_complex and the pool recovers", async () => {
    const slow = await outcome(
      renderMarkdownAsync(PATHOLOGICAL.stars!, { ...guest, ...FAST }),
    );
    expect(slow.code).toBe("too_complex");
    expect(slow.ms).toBeLessThan(FAST.timeoutMs + 5000);
    const after = await renderMarkdownAsync("# Hallo", { ...guest, ...FAST });
    expect(after).toBe('<h1 id="h-hallo">Hallo</h1>\n');
  });

  it("a slow job does not block another one running at the same time", async () => {
    const slow = outcome(
      renderMarkdownAsync(PATHOLOGICAL.stars!, { ...guest, timeoutMs: 1500 }),
    );
    const started = performance.now();
    const quick = await renderMarkdownAsync("kurz", guest);
    expect(quick).toContain("kurz");
    expect(performance.now() - started).toBeLessThan(3000);
    await slow;
  });

  it("rejects with unavailable when too many jobs are waiting", async () => {
    const jobs = Array.from({ length: MAX_QUEUED_JOBS + 8 }, () =>
      outcome(
        renderMarkdownAsync(PATHOLOGICAL.stars!, { ...guest, timeoutMs: 20 }),
      ),
    );
    const codes = (await Promise.all(jobs)).map((r) => r.code);
    expect(codes).toContain("unavailable");
    expect(codes).toContain("too_complex");
  }, 30_000);

  it("typical documents render within the budget", async () => {
    const doc = Array.from(
      { length: 400 },
      (_, i) =>
        `## Abschnitt ${i}\n\nText mit **fett**, *kursiv* und [Link](https://example.org/${i}).\n\n- eins\n- zwei\n`,
    ).join("\n");
    expect(doc.length).toBeLessThan(MAX_MARKDOWN_BYTES);
    const result = await outcome(renderMarkdownAsync(doc, guest));
    expect(result.code).toBe("ok");
    expect(result.ms).toBeLessThan(1500);
  });
});

describe("nesting guard", () => {
  const quote = (depth: number) => "> ".repeat(depth) + "x";
  const list = (depth: number) =>
    Array.from({ length: depth }, (_, i) => `${"  ".repeat(i)}- a`).join("\n");
  const maxOpen = (html: string, tag: string) => {
    let depth = 0;
    let max = 0;
    for (const m of html.matchAll(new RegExp(`</?${tag}>`, "g"))) {
      depth += m[0][1] === "/" ? -1 : 1;
      max = Math.max(max, depth);
    }
    return max;
  };

  it("renders nesting up to the limit normally", () => {
    expect(
      maxOpen(renderMarkdown(quote(MAX_NESTING_DEPTH), guest), "blockquote"),
    ).toBe(MAX_NESTING_DEPTH);
    expect(maxOpen(renderMarkdown(list(8), guest), "ul")).toBe(8);
  });

  it("renders lines nested deeper than the limit as plain text", () => {
    for (const md of [
      quote(MAX_NESTING_DEPTH + 1),
      "- ".repeat(MAX_NESTING_DEPTH + 1) + "x",
      "1. ".repeat(MAX_NESTING_DEPTH + 1) + "x",
      ">>>>>>>>>>>>>>>>>>>>>x",
      `${"  ".repeat(MAX_NESTING_DEPTH + 2)}- x`,
    ]) {
      const html = renderMarkdown(md, guest);
      expect(maxOpen(html, "blockquote"), md).toBe(0);
      expect(maxOpen(html, "ul"), md).toBe(0);
      expect(maxOpen(html, "ol"), md).toBe(0);
      expect(html).toContain("x");
    }
    const shown = renderMarkdown(`${quote(30)} <b>y</b>`, guest);
    expect(shown).toContain("&gt;");
    expect(shown).not.toContain("<b>");
  });

  it("deeply indented lists stay within the limit", async () => {
    const html = await renderMarkdownAsync(list(MAX_NESTING_DEPTH * 3), guest);
    expect(maxOpen(html, "ul")).toBeLessThanOrEqual(MAX_NESTING_DEPTH);
    expect(html).toContain("<li>");
  });

  it("only the offending lines are escaped, the rest of the document renders", () => {
    const html = renderMarkdown(
      `# Titel\n\n${quote(40)}\n\nEnde **fett**\n\n> zitat`,
      guest,
    );
    expect(html).toContain("<h1");
    expect(html).toContain("<strong>fett</strong>");
    expect(html).toContain("<blockquote>");
    expect(maxOpen(html, "blockquote")).toBe(1);
  });

  it("deep nesting up to 100k levels does not throw or overflow the stack", async () => {
    // A generous timeout: the point is that it completes without a crash, not how fast a slow
    // runner gets there.
    const slow = { timeoutMs: 30_000 };
    const md = "> ".repeat(90_000) + "x";
    const html = await renderMarkdownAsync(md, { ...guest, ...slow });
    expect(maxOpen(html, "blockquote")).toBe(0);
    expect(await extractHeadingsAsync(md, slow)).toEqual([]);
    expect(await extractPlainTextAsync(md, slow)).toContain("x");
    expect(limitNesting(md)).not.toBe(md);
    expect(limitNesting("> a\n- b\n1. c")).toBe("> a\n- b\n1. c");
  }, 120_000);

  it("falls back to escaped plain text when marked overflows the stack anyway", () => {
    vi.spyOn(
      Marked.prototype as unknown as { parseMarkdown(): () => never },
      "parseMarkdown",
    ).mockImplementation(() => () => {
      throw new RangeError("Maximum call stack size exceeded");
    });
    const html = renderMarkdown("a <script>alert(1)</script>", guest);
    expect(html).toBe("<pre>a &lt;script&gt;alert(1)&lt;/script&gt;</pre>\n");
    expect(extractPlainText("a *b*")).toBe("a *b*");
  });

  it("keeps the other headings when one segment is deeply nested", () => {
    expect(
      extractHeadings(`# Vorher\n\n${quote(40)}\n\n# Nachher`).map(
        (h) => h.text,
      ),
    ).toEqual(["Vorher", "Nachher"]);
  });
});

describe("async variants match the synchronous ones", () => {
  const resolvers = {
    resolveAttachmentUrl: (id: string) => `/files/${id}`,
    resolvePageUrl: (slug: string) => `/docs/${slug.toLowerCase()}`,
  };
  const docs = [
    "# Titel\n\nText mit **fett** und [[Heizung|Link]] ![x](attachment:abc)\n\n## Titel\n\n- a\n- b",
    ":::info\n## Info\nText\n:::\n\n:::secret\n## Geheim\nSECRETX\n:::\n\n```js\nconst a = 1;\n```",
    "",
    "nur Text",
    ":::secret\nSECRETX\n:::",
  ];

  it.each(docs.map((d) => [JSON.stringify(d.slice(0, 20)), d]))(
    "%s",
    async (_name, md) => {
      for (const options of [guest, member]) {
        const withResolvers = { ...options, ...resolvers };
        const sync = renderMarkdown(md, withResolvers);
        const async = await renderMarkdownAsync(md, withResolvers);
        expect(async.replace(/\s+/g, " ")).toBe(sync.replace(/\s+/g, " "));
      }
      const includeSecrets = { includeSecrets: true };
      expect(await extractPlainTextAsync(md)).toBe(extractPlainText(md));
      expect(await extractPlainTextAsync(md, includeSecrets)).toBe(
        extractPlainText(md, includeSecrets),
      );
      expect(await extractHeadingsAsync(md)).toEqual(extractHeadings(md));
      expect(await extractHeadingsAsync(md, includeSecrets)).toEqual(
        extractHeadings(md, includeSecrets),
      );
    },
  );

  it("never sends secret content to the worker or into the output for guests", async () => {
    const md =
      "öffentlich\n\n:::secret\nSECRETX\n:::\n\n<div>\n```\n:::secretive\nSECRETX\n:::\n";
    expect(await renderMarkdownAsync(md, guest)).not.toContain("SECRETX");
    expect(await extractPlainTextAsync(md)).not.toContain("SECRETX");
    expect(JSON.stringify(await extractHeadingsAsync(md))).not.toContain(
      "SECRETX",
    );
  });

  it("sanitizes worker output with the same allowlist (no active content)", async () => {
    const html = await renderMarkdownAsync(
      '<img src=x onerror=alert(1)><script>alert(1)</script>[x](javascript:alert(1))<h1 id="evil">t</h1>',
      guest,
    );
    expect(html).not.toMatch(/onerror|<script|javascript:|id="evil"/);
  });
});
