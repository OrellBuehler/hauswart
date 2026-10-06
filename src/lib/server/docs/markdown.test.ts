import { describe, expect, it } from "vitest";
import {
  extractHeadings,
  extractPlainText,
  renderMarkdown,
  slugify,
  type RenderMarkdownOptions,
} from "./markdown";

const member: RenderMarkdownOptions = { audience: "member" };
const guest: RenderMarkdownOptions = { audience: "guest" };

const resolvers = {
  resolveAttachmentUrl: (id: string) =>
    id === "abc123" ? `/api/v1/files/${id}` : null,
  resolvePageUrl: (slug: string) =>
    slug === "Heizung"
      ? "/docs/heizung"
      : slug === "Küche"
        ? "/docs/kueche"
        : null,
};
const withResolvers: RenderMarkdownOptions = {
  audience: "member",
  ...resolvers,
};

function render(md: string, options: RenderMarkdownOptions = member): string {
  return renderMarkdown(md, options);
}

const ALLOWED_TAGS = new Set([
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "p",
  "br",
  "ul",
  "ol",
  "li",
  "code",
  "pre",
  "blockquote",
  "table",
  "thead",
  "tbody",
  "tr",
  "th",
  "td",
  "a",
  "img",
  "hr",
  "strong",
  "em",
  "del",
  "input",
  "details",
  "summary",
  "div",
]);
const ALLOWED_ATTRS = new Set([
  "id",
  "href",
  "title",
  "rel",
  "target",
  "src",
  "alt",
  "loading",
  "decoding",
  "referrerpolicy",
  "type",
  "disabled",
  "checked",
  "open",
  "align",
  "start",
  "class",
]);

/** Structural check of the real tags in the output (escaped text such as &lt;script&gt; is fine). */
function assertNoActiveContent(html: string): void {
  for (const match of html.matchAll(/<(\/?)([a-zA-Z][a-zA-Z0-9-]*)([^>]*)>/g)) {
    const tag = match[2]!.toLowerCase();
    expect(ALLOWED_TAGS.has(tag), `tag <${tag}> in ${html}`).toBe(true);
    for (const attr of match[3]!.matchAll(
      /([a-zA-Z_:][-a-zA-Z0-9_:.]*)(?:="([^"]*)")?/g,
    )) {
      const name = attr[1]!.toLowerCase();
      expect(ALLOWED_ATTRS.has(name), `attribute ${name} in ${html}`).toBe(
        true,
      );
      if (name === "href" || name === "src") {
        const value = attr[2] ?? "";
        expect(value, html).toMatch(/^(?:https?:|mailto:|tel:|[^:]*$)/i);
        expect(value, html).not.toMatch(/^\s*[/\\]{2}/);
      }
    }
  }
}

describe("basic rendering", () => {
  it("renders headings, paragraphs, emphasis and lists", () => {
    const html = render(
      "# Titel\n\nText mit **fett**, *kursiv* und ~~weg~~.\n\n- a\n- b\n\n1. eins\n2. zwei",
    );
    expect(html).toContain("<h1");
    expect(html).toContain("Titel</h1>");
    expect(html).toContain("<strong>fett</strong>");
    expect(html).toContain("<em>kursiv</em>");
    expect(html).toContain("<del>weg</del>");
    expect(html).toContain("<ul>");
    expect(html).toContain("<ol>");
  });

  it("renders code blocks and inline code with escaped content", () => {
    const html = render("`<b>x</b>`\n\n```js\nconst a = '<script>';\n```");
    expect(html).toContain("<code>&lt;b&gt;x&lt;/b&gt;</code>");
    expect(html).toContain('<code class="language-js">');
    expect(html).toContain("&lt;script&gt;");
    expect(html).not.toContain("<script>");
  });

  it("renders tables with alignment only from the allowed values", () => {
    const html = render("| a | b |\n|:-:|--:|\n| 1 | 2 |");
    expect(html).toContain("<table>");
    expect(html).toContain('<th align="center">a</th>');
    expect(html).toContain('<th align="right">b</th>');
    const raw = render(
      '<table><tr><td align="javascript:x">c</td></tr></table>',
    );
    expect(raw).not.toContain("javascript");
    expect(raw).not.toContain('align="');
  });

  it("renders blockquote, hr and details/summary", () => {
    const html = render(
      "> zitat\n\n---\n\n<details open><summary>Mehr</summary>\n\nInhalt\n\n</details>",
    );
    expect(html).toContain("<blockquote>");
    expect(html).toContain("<hr />");
    expect(html).toContain("<details open>");
    expect(html).toContain("<summary>Mehr</summary>");
  });

  it("renders task lists as disabled checkboxes", () => {
    const html = render("- [x] erledigt\n- [ ] offen");
    expect(html).toContain(
      '<input type="checkbox" disabled="disabled" checked="checked" />',
    );
    expect(html).toContain(
      '<input type="checkbox" disabled="disabled" /> offen',
    );
  });

  it("forces task list checkboxes to disabled and drops other inputs", () => {
    const html = render(
      '<input type="checkbox" checked> a <input type="text" value="x"> b <input type="password"> <input type="file"> <input type="submit" formaction="/x"> <button>go</button>',
    );
    expect(html.match(/<input/g)?.length).toBe(1);
    expect(html).toContain(
      '<input type="checkbox" disabled="disabled" checked="checked" />',
    );
    expect(html).not.toContain("<button");
    expect(html).not.toContain("formaction");
    expect(html).not.toContain("password");
  });

  it("autolinks bare urls and renders strikethrough", () => {
    const html = render(
      "Siehe https://example.org/a?x=1&y=2 oder www.example.org",
    );
    expect(html).toContain('href="https://example.org/a?x=1&amp;y=2"');
    expect(html).toContain('href="http://www.example.org"');
  });

  it("returns an empty string for empty input", () => {
    expect(render("")).toBe("");
    expect(render("   \n\n")).toBe("");
  });

  it("normalizes CRLF line endings", () => {
    const html = render("# A\r\n\r\ntext\r\n\r\n:::info\r\nx\r\n:::\r\n");
    expect(html).toContain("callout-info");
    expect(html).toContain("<h1");
  });
});

describe("links", () => {
  it("allows http, https, mailto, tel and relative links", () => {
    const html = render(
      "[a](http://example.org) [b](https://example.org) [c](mailto:me@example.org) [d](tel:+41000000000) [e](/docs/x) [f](#abschnitt) [g](../up) [h](rel/path?q=1)",
    );
    expect(html).toContain('href="http://example.org"');
    expect(html).toContain('href="https://example.org"');
    expect(html).toContain('href="mailto:me@example.org"');
    expect(html).toContain('href="tel:+41000000000"');
    expect(html).toContain('href="/docs/x"');
    expect(html).toContain('href="#abschnitt"');
    expect(html).toContain('href="../up"');
    expect(html).toContain('href="rel/path?q=1"');
  });

  it("adds rel and target to external http(s) links only", () => {
    const html = render(
      "[a](https://example.org) [b](/intern) [c](mailto:x@example.org)",
    );
    expect(html).toContain(
      '<a href="https://example.org" target="_blank" rel="noopener noreferrer nofollow">a</a>',
    );
    expect(html).toContain('<a href="/intern">b</a>');
    expect(html).toContain('<a href="mailto:x@example.org">c</a>');
  });

  it("overrides author supplied rel and target", () => {
    const html = render(
      '<a href="https://example.org" rel="opener" target="_self">x</a> <a href="/rel" target="_blank" rel="x">y</a>',
    );
    expect(html).toContain(
      'target="_blank" rel="noopener noreferrer nofollow">x</a>',
    );
    expect(html).toContain('<a href="/rel">y</a>');
  });

  it("keeps the title attribute", () => {
    expect(render('[a](https://example.org "Tipp")')).toContain('title="Tipp"');
  });
});

describe("xss vectors", () => {
  const hostileLinks = [
    "javascript:alert(1)",
    "JaVaScRiPt:alert(1)",
    "  javascript:alert(1)",
    "java\tscript:alert(1)",
    "java&#10;script:alert(1)",
    "java&#x09;script:alert(1)",
    "&#106;avascript:alert(1)",
    "&#x6A;avascript:alert(1)",
    "javascript&colon;alert(1)",
    "vbscript:msgbox(1)",
    "data:text/html,<script>alert(1)</script>",
    "data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==",
    "file:///etc/passwd",
    "ftp://example.org/x",
    "blob:https://example.org/x",
    "\u0001javascript:alert(1)",
    "//evil.example.org",
    "\\\\evil.example.org",
    "/\\evil.example.org",
    "\\/evil.example.org",
  ];

  for (const link of hostileLinks) {
    it(`neutralizes markdown link ${JSON.stringify(link)}`, () => {
      const html =
        render(`[klick](${link})`) + render(`<a href="${link}">klick</a>`);
      assertNoActiveContent(html);
      expect(html).not.toMatch(
        /href="\/\/|href="\\|href="file:|href="ftp:|href="blob:|href="vbscript:/i,
      );
      expect(html).toContain("klick");
    });
  }

  it("drops protocol-relative links entirely", () => {
    const html = render(
      "[x](//evil.example.org/a) <a href='//evil.example.org'>y</a>",
    );
    expect(html).not.toContain("evil.example.org");
  });

  it("strips event handler attributes", () => {
    const html = render(
      '<img src="/a.png" onerror="alert(1)" onload="alert(2)"> <a href="/x" onclick="alert(3)" onmouseover="alert(4)">x</a> <p onclick="alert(5)">p</p> <details ontoggle="alert(6)" open><summary>s</summary></details>',
    );
    assertNoActiveContent(html);
    expect(html).toContain('<img src="/a.png"');
    expect(html).toContain("<p>p</p>");
  });

  it("removes script, style, iframe, object, embed, form, meta, link, base and svg", () => {
    const html = render(
      [
        "<script>alert(1)</script>",
        "<style>body{display:none}</style>",
        '<iframe src="https://example.org"></iframe>',
        '<iframe srcdoc="<script>alert(1)</script>"></iframe>',
        '<object data="x.swf"></object>',
        '<embed src="x.swf">',
        '<form action="/x"><input type="submit"></form>',
        '<meta http-equiv="refresh" content="0;url=javascript:alert(1)">',
        '<link rel="stylesheet" href="https://evil.example.org/x.css">',
        '<base href="https://evil.example.org/">',
        '<svg onload="alert(1)"><script>alert(2)</script><a xlink:href="javascript:alert(3)"><text>t</text></a></svg>',
        "<math><mtext><script>alert(1)</script></mtext></math>",
        '<noscript><p title="</noscript><img src=x onerror=alert(1)>"></noscript>',
        "<textarea><script>alert(1)</script></textarea>",
      ].join("\n\n"),
    );
    assertNoActiveContent(html);
    for (const tag of [
      "object",
      "embed",
      "form",
      "meta",
      "link",
      "base",
      "math",
      "noscript",
      "textarea",
      "button",
    ]) {
      expect(html).not.toMatch(new RegExp(`<${tag}[\\s>]`, "i"));
    }
    expect(html).not.toContain("alert(");
    expect(html).not.toContain("display:none");
  });

  it("removes inline styles and classes", () => {
    const html = render(
      '<p style="position:fixed;top:0" class="secret callout">x</p> <a href="/x" style="color:red" class="a">y</a> <span style="x">z</span> <div class="secret">leak</div>',
    );
    expect(html).not.toContain("style");
    expect(html).not.toContain("class=");
    expect(html).toContain("<p>x</p>");
  });

  it("only allows language-* classes on code", () => {
    const html = render(
      '<code class="language-js evil other">x</code><pre><code class="hack">y</code></pre>',
    );
    expect(html).toContain('class="language-js"');
    expect(html).not.toContain("evil");
    expect(html).not.toContain("hack");
  });

  it("removes data: uris from images and links", () => {
    const html = render(
      '![x](data:image/png;base64,iVBORw0KGgo=) <img src="data:image/svg+xml,<svg onload=alert(1)>"> [y](data:text/html,x)',
    );
    assertNoActiveContent(html);
    expect(html).not.toContain("<img");
  });

  it("removes svg images and svg data uris", () => {
    const html = render(
      '![x](data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=) <svg><circle r="1"/></svg>',
    );
    expect(html).not.toContain("svg");
    expect(html).not.toContain("<img");
  });

  it("only allows http, https and relative image sources", () => {
    const html = render(
      "![a](https://example.org/a.png) ![b](/files/b.png) ![c](mailto:x@example.org) ![d](tel:123) ![e](ftp://example.org/e.png) ![f](//evil.example.org/f.png) ![g](javascript:alert(1))",
    );
    expect(html.match(/<img/g)?.length).toBe(2);
    expect(html).toContain('src="https://example.org/a.png"');
    expect(html).toContain('src="/files/b.png"');
  });

  it("hardens images with lazy loading and no referrer", () => {
    const html = render("![a](https://example.org/a.png)");
    expect(html).toContain('loading="lazy"');
    expect(html).toContain('referrerpolicy="no-referrer"');
  });

  it("removes images without a source and unknown attributes", () => {
    const html = render(
      '<img alt="x"> <img src="" alt="y"> <img src="/a.png" srcset="//evil.example.org/x 2x" width="9999" data-x="1" name="x" id="y">',
    );
    expect(html.match(/<img/g)?.length).toBe(1);
    expect(html).not.toContain("srcset");
    expect(html).not.toContain("width");
    expect(html).not.toContain("data-x");
    expect(html).not.toContain('id="y"');
  });

  it("escapes html injected through alt text and titles", () => {
    const html = render(
      '![a"><script>alert(1)</script>](/a.png "t\\"><img src=x onerror=alert(1)>")',
    );
    assertNoActiveContent(html);
    expect(html.match(/<img/g)?.length).toBe(1);
  });

  it("cannot smuggle the internal drop marker through raw html", () => {
    const html = render(
      '<img src="/a.png" alt="x" data-hw-drop="1"> <a href="/x" data-hw-drop="1">keep</a>',
    );
    expect(html).toContain("<img");
    expect(html).toContain('<a href="/x">keep</a>');
    expect(html).not.toContain("data-hw-drop");
  });

  it("handles nested markdown and html tricks", () => {
    const vectors = [
      "[![x](https://example.org/a.png)](javascript:alert(1))",
      '<a href="javascript:alert(1)"><img src=x onerror=alert(1)></a>',
      "**<img src=x onerror=alert(1)>**",
      "> <script>alert(1)</script>",
      "- <img src=x onerror=alert(1)>",
      "| a |\n|---|\n| <img src=x onerror=alert(1)> |",
      "<<script>alert(1)</script>script>alert(1)</script>",
      "<scr<script>ipt>alert(1)</scr</script>ipt>",
      '<img src="x" onerror=alert(1)//',
      '<a href="x" "onclick=alert(1)">y</a>',
      "<div><p><b onmouseover=alert(1)>bold</b></p></div>",
      "[a]: javascript:alert(1)\n\n[a]",
      "[a]\n\n[a]: <javascript:alert(1)>",
      "<javascript:alert(1)>",
      '<https://example.org/"onmouseover="alert(1)>',
      "`</code><script>alert(1)</script>`",
      "```\n</code></pre><script>alert(1)</script>\n```",
      "<details open ontoggle=alert(1)><summary onclick=alert(1)>x</summary></details>",
      "<!-- <script>alert(1)</script> -->",
      "<![CDATA[<script>alert(1)</script>]]>",
      "<?php echo 1; ?>",
      "&lt;script&gt;alert(1)&lt;/script&gt;",
      '<a href="&#x6A;&#x61;&#x76;&#x61;&#x73;&#x63;&#x72;&#x69;&#x70;&#x74;&#x3A;alert(1)">x</a>',
    ];
    for (const vector of vectors) {
      const html = render(vector, withResolvers);
      assertNoActiveContent(html);
      // no tag outside the allowlist may survive
      const tags = [...html.matchAll(/<\/?([a-z][a-z0-9-]*)/gi)].map((m) =>
        m[1]!.toLowerCase(),
      );
      const allowed = new Set([
        "h1",
        "h2",
        "h3",
        "h4",
        "h5",
        "h6",
        "p",
        "br",
        "ul",
        "ol",
        "li",
        "code",
        "pre",
        "blockquote",
        "table",
        "thead",
        "tbody",
        "tr",
        "th",
        "td",
        "a",
        "img",
        "hr",
        "strong",
        "em",
        "del",
        "input",
        "details",
        "summary",
        "div",
      ]);
      for (const tag of tags)
        expect(allowed.has(tag), `${tag} in ${vector}`).toBe(true);
    }
  });

  it("does not execute escaped entities as html", () => {
    const html = render("&lt;script&gt;alert(1)&lt;/script&gt;");
    expect(html).not.toContain("<script");
    expect(html).toContain("&lt;script&gt;");
  });

  it("neutralizes html comments and cdata", () => {
    const html = render("a <!-- hidden <b>x</b> --> b");
    expect(html).not.toContain("<!--");
  });

  it("ignores author supplied heading ids (no DOM clobbering)", () => {
    const html = render(
      '<h2 id="location">x</h2>\n\n<h3 id="hw-guess-evil">y</h3>\n\n<p id="body">z</p>\n\n<a name="top" id="q" href="/x">a</a>',
    );
    expect(html).not.toContain('id="location"');
    expect(html).not.toContain("evil");
    expect(html).not.toContain('id="body"');
    expect(html).not.toContain("name=");
    expect(html).not.toContain('id="q"');
  });

  it("does not let authors forge the generated heading prefix", () => {
    const html = render('<h2 id="hw-x-pwned">x</h2>');
    expect(html).not.toContain("pwned");
  });

  it("cannot spoof secret or callout wrappers with raw html", () => {
    const html = render('<div class="secret">fake</div>', guest);
    expect(html).not.toContain("<div");
    expect(html).not.toContain("secret");
  });

  it("survives pathological input without throwing", () => {
    const inputs = [
      "[".repeat(5000),
      "*".repeat(5000),
      "<".repeat(5000),
      "[[".repeat(2000),
      "> ".repeat(2000) + "x",
      "- ".repeat(2000) + "x",
      ":::warning\n".repeat(5000),
      ":::secret\n".repeat(5000),
      "\u0000\u0001\u0002 \u202e",
    ];
    for (const input of inputs) {
      expect(() => render(input, guest)).not.toThrow();
    }
  });
});

describe("attachment scheme", () => {
  it("rewrites attachment images through the resolver", () => {
    const html = render("![Foto](attachment:abc123)", withResolvers);
    expect(html).toContain('src="/api/v1/files/abc123"');
    expect(html).toContain('alt="Foto"');
  });

  it("rewrites attachment links through the resolver", () => {
    const html = render("[Handbuch](attachment:abc123)", withResolvers);
    expect(html).toContain('<a href="/api/v1/files/abc123">Handbuch</a>');
  });

  it("removes unknown attachment images and keeps link text for unknown attachment links", () => {
    const html = render(
      "![x](attachment:nope) [Handbuch](attachment:nope)",
      withResolvers,
    );
    expect(html).not.toContain("<img");
    expect(html).not.toContain("<a");
    expect(html).not.toContain("attachment:");
    expect(html).toContain("Handbuch");
  });

  it("removes attachments when no resolver is configured", () => {
    const html = render("![x](attachment:abc123) [y](attachment:abc123)");
    expect(html).not.toContain("<img");
    expect(html).not.toContain("<a ");
    expect(html).not.toContain("attachment:");
  });

  it("rejects malformed attachment ids without calling the resolver", () => {
    const seen: string[] = [];
    const html = render(
      "![a](attachment:../../etc/passwd) ![b](attachment:) ![c](attachment:a/b) ![d](attachment:<x>) ![e](attachment:" +
        "a".repeat(65) +
        ")",
      {
        audience: "member",
        resolveAttachmentUrl: (id) => (seen.push(id), "/f/" + id),
      },
    );
    expect(seen).toEqual([]);
    expect(html).not.toContain("<img");
  });

  it("is case-insensitive about the scheme and also works in raw html", () => {
    const html = render(
      '![a](ATTACHMENT:abc123) <img src="attachment:abc123" alt="b">',
      withResolvers,
    );
    expect(html.match(/src="\/api\/v1\/files\/abc123"/g)?.length).toBe(2);
  });

  it("neutralizes resolver output that is not a safe url", () => {
    const html = render("![a](attachment:abc123) [b](attachment:abc123)", {
      audience: "member",
      resolveAttachmentUrl: () => "javascript:alert(1)",
    });
    assertNoActiveContent(html);
    expect(html).not.toContain("<img");
  });

  it("does not resolve attachments inside code", () => {
    const html = render("`![a](attachment:abc123)`", withResolvers);
    expect(html).not.toContain("<img");
    expect(html).toContain("attachment:abc123");
  });
});

describe("wiki links", () => {
  it("rewrites [[slug]] through the resolver", () => {
    const html = render("Siehe [[Heizung]] bitte.", withResolvers);
    expect(html).toContain('<a href="/docs/heizung">Heizung</a>');
  });

  it("supports [[slug|label]]", () => {
    const html = render("[[Heizung|die Heizung]]", withResolvers);
    expect(html).toContain('<a href="/docs/heizung">die Heizung</a>');
  });

  it("handles umlauts in slugs", () => {
    const html = render("[[Küche]]", withResolvers);
    expect(html).toContain('<a href="/docs/kueche">Küche</a>');
  });

  it("renders unknown pages as plain text", () => {
    const html = render(
      "[[Unbekannt]] und [[Unbekannt|Anderer Text]]",
      withResolvers,
    );
    expect(html).not.toContain("<a");
    expect(html).toContain("Unbekannt");
    expect(html).toContain("Anderer Text");
  });

  it("renders as plain text without a resolver", () => {
    expect(render("[[Heizung]]")).not.toContain("<a");
  });

  it("does not rewrite wiki links in code", () => {
    const html = render(
      "`[[Heizung]]`\n\n```\n[[Heizung]]\n```",
      withResolvers,
    );
    expect(html).not.toContain("<a");
    expect(html.match(/\[\[Heizung\]\]/g)?.length).toBe(2);
  });

  it("escapes html in labels and slugs", () => {
    const seen: string[] = [];
    const html = render(
      "[[<img src=x onerror=alert(1)>|<script>alert(2)</script>]]",
      {
        audience: "member",
        resolvePageUrl: (slug) => (seen.push(slug), "/docs/x"),
      },
    );
    assertNoActiveContent(html);
    expect(html).not.toContain("<img");
    expect(seen.length).toBe(1);
  });

  it("neutralizes unsafe resolver output", () => {
    const html = render("[[Heizung]]", {
      audience: "member",
      resolvePageUrl: () => "javascript:alert(1)",
    });
    assertNoActiveContent(html);
    expect(html).not.toContain("<a");
  });

  it("ignores empty and unterminated wiki links", () => {
    const html = render("[[]] [[ ]] [[unclosed", withResolvers);
    expect(html).not.toContain("<a");
  });

  it("works inside lists, tables and emphasis", () => {
    const html = render(
      "- [[Heizung]]\n\n| x |\n|---|\n| [[Heizung]] |\n\n**[[Heizung]]**",
      withResolvers,
    );
    expect(html.match(/href="\/docs\/heizung"/g)?.length).toBe(3);
  });
});

describe("secret blocks", () => {
  const md = "Vorher\n\n:::secret\nAlarmcode 1234\n:::\n\nNachher";

  it("shows secrets to members in a secret wrapper", () => {
    const html = render(md, member);
    expect(html).toContain('<div class="secret">');
    expect(html).toContain("Alarmcode 1234");
    expect(html).toContain("Vorher");
    expect(html).toContain("Nachher");
  });

  it("removes secrets entirely for guests", () => {
    const html = render(md, guest);
    expect(html).not.toContain("1234");
    expect(html).not.toContain("Alarmcode");
    expect(html).not.toContain("secret");
    expect(html).toContain("Vorher");
    expect(html).toContain("Nachher");
  });

  it("shows secrets to guests only with includeSecrets", () => {
    const html = render(md, { audience: "guest", includeSecrets: true });
    expect(html).toContain('<div class="secret">');
    expect(html).toContain("1234");
  });

  it("explicit includeSecrets: false hides secrets from guests", () => {
    expect(
      render(md, { audience: "guest", includeSecrets: false }),
    ).not.toContain("1234");
  });

  it("members see secrets regardless of includeSecrets", () => {
    expect(render(md, { audience: "member", includeSecrets: false })).toContain(
      "1234",
    );
  });

  it("renders markdown inside secret blocks", () => {
    const html = render(":::secret\n**Code:** `4711`\n\n- eins\n:::", member);
    expect(html).toContain("<strong>Code:</strong>");
    expect(html).toContain("<code>4711</code>");
    expect(html).toContain("<li>eins</li>");
  });

  it("fails closed for unterminated secret blocks", () => {
    const html = render(
      "Offen\n\n:::secret\ngeheim 9999\n\nweiter geheim",
      guest,
    );
    expect(html).toContain("Offen");
    expect(html).not.toContain("geheim");
    expect(html).not.toContain("9999");
  });

  it("treats anything after :::secret on the opening line as part of the opener", () => {
    for (const opener of [
      ":::secret Code",
      "::: secret",
      ":::SECRET",
      ":::Secret   ",
      ":::::secret",
      "   :::secret",
    ]) {
      const html = render(`${opener}\ngeheim 9999\n:::\nöffentlich`, guest);
      expect(html, opener).not.toContain("9999");
      expect(html, opener).toContain("öffentlich");
    }
  });

  it("removes nested blocks inside a hidden secret and resumes after the outer close", () => {
    const html = render(
      ":::secret\nA geheim\n\n:::warning\nB geheim\n:::\n\nC geheim\n:::\n\nöffentlich",
      guest,
    );
    expect(html).not.toContain("geheim");
    expect(html).toContain("öffentlich");
    expect(html).not.toContain("callout");
  });

  it("removes secrets nested inside visible callouts for guests", () => {
    const html = render(
      ":::warning\nsichtbar\n\n:::secret\ngeheim\n:::\n\nauch sichtbar\n:::",
      guest,
    );
    expect(html).toContain("sichtbar");
    expect(html).toContain("auch sichtbar");
    expect(html).not.toContain("geheim");
    expect(html).toContain("callout-warning");
  });

  it("hides secrets nested beyond the depth limit", () => {
    const open = (n: number) => ":::info\n".repeat(n);
    const html = render(
      `${open(12)}${":::secret\nSEKRET\n:::\n"}${":::\n".repeat(12)}ende`,
      guest,
    );
    expect(html).not.toContain("SEKRET");
    expect(html).toContain("ende");
    const shown = render(
      `${open(12)}${":::secret\nSEKRET\n:::\n"}${":::\n".repeat(12)}ende`,
      member,
    );
    expect(shown).toContain("SEKRET");
  });

  it("does not leak secret content through headings, wiki links, attachments or plain text", () => {
    const secretMd =
      ":::secret\n## Geheimer Titel\n[[Heizung]] ![x](attachment:abc123)\n:::\n\n## Offen";
    const html = render(secretMd, { audience: "guest", ...resolvers });
    expect(html).not.toContain("Geheimer");
    expect(html).not.toContain("heizung");
    expect(html).not.toContain("abc123");
    expect(extractHeadings(secretMd).map((h) => h.text)).toEqual(["Offen"]);
    expect(extractPlainText(secretMd)).toBe("Offen");
  });

  it("ignores ::: markers inside fenced code", () => {
    const html = render("```\n:::secret\nnicht geheim\n:::\n```", guest);
    expect(html).toContain("nicht geheim");
    expect(html).toContain(":::secret");
    const tilde = render(
      "~~~\n:::secret\nnoch nicht geheim\n~~~\n\nnach dem Code",
      guest,
    );
    expect(tilde).toContain("noch nicht geheim");
  });

  it("still hides a secret that contains a fenced block with ::: markers", () => {
    const html = render(
      ":::secret\n```\n:::\ngeheimer code\n```\n:::\n\nöffentlich",
      guest,
    );
    expect(html).not.toContain("geheim");
    expect(html).toContain("öffentlich");
  });

  it("does not treat indented code or four-space indented markers as blocks", () => {
    const html = render("    :::secret\n    code\n    :::", guest);
    expect(html).toContain("<pre>");
    expect(html).toContain(":::secret");
  });

  it("a stray closing marker is plain text", () => {
    const html = render("a\n\n:::\n\nb", guest);
    expect(html).toContain("a");
    expect(html).toContain("b");
  });

  it("works when the secret is the whole document", () => {
    expect(render(":::secret\nx\n:::", guest)).toBe("");
  });

  it("handles multiple secret blocks", () => {
    const html = render(
      "a\n\n:::secret\n1\n:::\n\nb\n\n:::secret\n2\n:::\n\nc",
      guest,
    );
    expect(html).toContain("a");
    expect(html).toContain("b");
    expect(html).toContain("c");
    expect(html).not.toMatch(/>1</);
    expect(html).not.toMatch(/>2</);
  });
});

describe("callouts", () => {
  it("renders warning and info callouts", () => {
    const html = render(
      ":::warning\nAchtung **Wasser**\n:::\n\n:::info\nHinweis\n:::",
      guest,
    );
    expect(html).toContain('<div class="callout callout-warning">');
    expect(html).toContain('<div class="callout callout-info">');
    expect(html).toContain("<strong>Wasser</strong>");
  });

  it("renders callouts for both audiences without includeSecrets", () => {
    expect(render(":::info\nx\n:::", guest)).toContain("callout-info");
    expect(render(":::info\nx\n:::", member)).toContain("callout-info");
  });

  it("nests callouts and keeps the structure balanced", () => {
    const html = render(
      ":::warning\nA\n\n:::info\nB\n:::\n\nC\n:::\n\nD",
      guest,
    );
    expect(html.match(/<div/g)?.length).toBe(2);
    expect(html.match(/<\/div>/g)?.length).toBe(2);
    expect(html.indexOf("callout-warning")).toBeLessThan(
      html.indexOf("callout-info"),
    );
    expect(html.lastIndexOf("D")).toBeGreaterThan(html.lastIndexOf("</div>"));
  });

  it("auto-closes unterminated callouts with balanced html", () => {
    const html = render(":::warning\noffen", guest);
    expect(html.match(/<div/g)?.length).toBe(1);
    expect(html.match(/<\/div>/g)?.length).toBe(1);
  });

  it("keeps wrappers balanced even when the content has unbalanced raw html", () => {
    const html = render(
      ":::warning\n<details>\n\ninner\n:::\n\n</details>\n\nafter",
      guest,
    );
    expect(html.match(/<div/g)?.length).toBe(1);
    expect(html.match(/<\/div>/g)?.length).toBe(1);
    expect(html.match(/<details/g)?.length).toBe(
      html.match(/<\/details>/g)?.length,
    );
    const inner = html.slice(html.indexOf("<div"), html.indexOf("</div>"));
    expect(inner).toContain("inner");
    expect(inner).not.toContain("after");
  });

  it("treats unknown block names as transparent and balanced", () => {
    const html = render(":::tip\nText\n:::\n\nnach", guest);
    expect(html).toContain("Text");
    expect(html).toContain("nach");
    expect(html).not.toContain("<div");
    const inside = render(":::warning\n:::tip\nx\n:::\ny\n:::\nz", guest);
    expect(inside.match(/<div/g)?.length).toBe(1);
    expect(inside.indexOf("z")).toBeGreaterThan(inside.indexOf("</div>"));
  });

  it("limits wrapper nesting depth", () => {
    const html = render(
      ":::info\n".repeat(30) + "tief\n" + ":::\n".repeat(30),
      guest,
    );
    expect(html.match(/<div/g)?.length).toBe(8);
    expect(html).toContain("tief");
  });

  it("sanitizes content inside callouts", () => {
    const html = render(
      ":::warning\n<script>alert(1)</script><img src=x onerror=alert(1)>\n:::",
      guest,
    );
    assertNoActiveContent(html);
  });
});

describe("headings", () => {
  it("adds stable ids to rendered headings", () => {
    const html = render("# Hallo Welt\n\n## Zweiter Abschnitt");
    expect(html).toContain('<h1 id="hallo-welt">Hallo Welt</h1>');
    expect(html).toContain('<h2 id="zweiter-abschnitt">Zweiter Abschnitt</h2>');
  });

  it("renders the same ids on every render", () => {
    const md = "# A\n\n## B\n\n## B";
    expect(render(md)).toBe(render(md).replace(/hw-[0-9a-f]{32}-/g, ""));
    expect(render(md)).toBe(render(md));
  });

  it("is umlaut-safe", () => {
    expect(slugify("Größe der Küche")).toBe("groesse-der-kueche");
    expect(slugify("Öl & Fett")).toBe("oel-fett");
    expect(slugify("Ärger über Übergabe")).toBe("aerger-ueber-uebergabe");
    expect(slugify("Straße")).toBe("strasse");
    expect(slugify("Café Crème")).toBe("cafe-creme");
    expect(slugify("A\u0308rger")).toBe("aerger");
  });

  it("falls back to 'section' for headings without ascii letters", () => {
    expect(slugify("???")).toBe("section");
    expect(slugify("日本語")).toBe("section");
    expect(slugify("")).toBe("section");
  });

  it("de-duplicates ids in document order", () => {
    const html = render("# Heizung\n\n## Heizung\n\n### Heizung");
    expect(html).toContain('id="heizung"');
    expect(html).toContain('id="heizung-1"');
    expect(html).toContain('id="heizung-2"');
  });

  it("derives ids from the plain text of formatted headings", () => {
    const html = render("## **Fett** und [Link](https://example.org) `Code`");
    expect(html).toContain('id="fett-und-link-code"');
  });

  it("extractHeadings matches the rendered ids", () => {
    const md =
      "# Übersicht\n\n## Küche\n\ntext\n\n## Küche\n\n> ### Zitat-Überschrift\n\n- ### Liste\n\n## **Fett** `x`";
    const headings = extractHeadings(md);
    expect(headings).toEqual([
      { level: 1, text: "Übersicht", id: "uebersicht" },
      { level: 2, text: "Küche", id: "kueche" },
      { level: 2, text: "Küche", id: "kueche-1" },
      { level: 3, text: "Zitat-Überschrift", id: "zitat-ueberschrift" },
      { level: 3, text: "Liste", id: "liste" },
      { level: 2, text: "Fett x", id: "fett-x" },
    ]);
    const rendered = [...render(md).matchAll(/<h([1-6]) id="([^"]+)"/g)].map(
      (m) => ({
        level: Number(m[1]),
        id: m[2],
      }),
    );
    expect(rendered).toEqual(
      headings.map((h) => ({ level: h.level, id: h.id })),
    );
  });

  it("keeps ids consistent across callout boundaries", () => {
    const md = "# A\n\n:::info\n## A\n:::\n\n## A";
    const ids = extractHeadings(md).map((h) => h.id);
    expect(ids).toEqual(["a", "a-1", "a-2"]);
    const rendered = [
      ...render(md, guest).matchAll(/<h[1-6] id="([^"]+)"/g),
    ].map((m) => m[1]);
    expect(rendered).toEqual(ids);
  });

  it("keeps ids consistent when secrets are hidden", () => {
    const md = "# A\n\n:::secret\n## A\n:::\n\n## A";
    const guestIds = extractHeadings(md).map((h) => h.id);
    expect(guestIds).toEqual(["a", "a-1"]);
    const memberIds = extractHeadings(md, { includeSecrets: true }).map(
      (h) => h.id,
    );
    expect(memberIds).toEqual(["a", "a-1", "a-2"]);
    const rendered = [
      ...render(md, member).matchAll(/<h[1-6] id="([^"]+)"/g),
    ].map((m) => m[1]);
    expect(rendered).toEqual(memberIds);
  });

  it("does not list headings inside code blocks", () => {
    expect(extractHeadings("```\n# nope\n```\n\n# ja")).toEqual([
      { level: 1, text: "ja", id: "ja" },
    ]);
  });

  it("decodes entities in heading text", () => {
    expect(extractHeadings("# Wasser & Strom")[0]!.text).toBe("Wasser & Strom");
  });

  it("returns an empty list for documents without headings", () => {
    expect(extractHeadings("nur Text")).toEqual([]);
    expect(extractHeadings("")).toEqual([]);
  });
});

describe("extractPlainText", () => {
  it("strips markdown formatting", () => {
    const text = extractPlainText(
      "# Titel\n\nText mit **fett**, *kursiv*, ~~weg~~ und [Link](https://example.org) und `Code`.\n\n- eins\n- zwei\n\n> Zitat\n\n---\n\n![Bild](/a.png)",
    );
    expect(text).toBe(
      "Titel Text mit fett, kursiv, weg und Link und Code. eins zwei Zitat",
    );
  });

  it("does not contain markup characters", () => {
    const text = extractPlainText(
      "## **A** _b_ [c](d)\n\n1. x\n2. y\n\n| h1 | h2 |\n|---|---|\n| c1 | c2 |",
    );
    expect(text).toBe("A b c x y h1 h2 c1 c2");
  });

  it("keeps wiki link labels, task list text and code block content", () => {
    const text = extractPlainText(
      "[[Heizung|die Heizung]] [[Küche]]\n\n- [x] fertig\n\n```\ncode zeile\n```",
    );
    expect(text).toContain("die Heizung");
    expect(text).toContain("Küche");
    expect(text).toContain("fertig");
    expect(text).toContain("code zeile");
  });

  it("strips raw html and drops script content", () => {
    const text = extractPlainText(
      "a <b>fett</b> <script>alert(1)</script> b <style>x{}</style>",
    );
    expect(text).toBe("a fett b");
  });

  it("decodes entities and keeps umlauts", () => {
    expect(extractPlainText("Wasser &amp; Strom für Büro")).toBe(
      "Wasser & Strom für Büro",
    );
  });

  it("excludes secrets unless includeSecrets", () => {
    const md =
      "öffentlich\n\n:::secret\ngeheim\n:::\n\n:::warning\nachtung\n:::";
    expect(extractPlainText(md)).toBe("öffentlich achtung");
    expect(extractPlainText(md, { includeSecrets: true })).toBe(
      "öffentlich geheim achtung",
    );
  });

  it("truncates to maxLength with an ellipsis", () => {
    const text = extractPlainText("abcdefghij klmnop", { maxLength: 8 });
    expect(text.length).toBe(8);
    expect(text.endsWith("…")).toBe(true);
    expect(extractPlainText("kurz", { maxLength: 100 })).toBe("kurz");
  });

  it("returns an empty string for empty input", () => {
    expect(extractPlainText("")).toBe("");
  });
});
