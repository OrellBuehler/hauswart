import { describe, expect, it } from "vitest";
import { extractHeadings, extractPlainText, renderMarkdown } from "./markdown";

const MARK = "SECRETX";

/** Inputs where the author meant a secret block and a guest must never see MARK. */
const SECRET_CASES: [string, string][] = [
  [
    "html block hides a fence from the tracker",
    "<div>\n```\n:::secret\nSECRETX\n:::\n",
  ],
  [
    "details with an open fence",
    "<details>\n```\n:::secret\nSECRETX\n:::\n</details>",
  ],
  ["html block with a tilde fence", "<div>\n~~~\n:::secret\nSECRETX\n:::\n"],
  [
    "html comment containing a fence",
    "<!--\n```\n-->\n:::secret\nSECRETX\n:::",
  ],
  [":::secretive", ":::secretive\nSECRETX\n:::"],
  [":::secrets", ":::secrets\nSECRETX\n:::"],
  [":::secret-notes", ":::secret-notes\nSECRETX\n:::"],
  ["four-space indent", "    :::secret\n    SECRETX\n    :::"],
  [
    "indented inside a list item",
    "- item\n\n    :::secret\n    SECRETX\n    :::",
  ],
  ["inside a blockquote", "> :::secret\n> SECRETX\n> :::"],
  ["after a list marker", "- :::secret\n  SECRETX\n  :::"],
  ["after an ordered list marker", "1. :::secret\n   SECRETX\n   :::"],
  ["four colons", "::::secret\nSECRETX\n::::"],
  ["upper case", ":::SECRET\nSECRETX\n:::"],
  ["mixed case", ":::SeCrEt\nSECRETX\n:::"],
  ["CRLF line endings", ":::secret\r\nSECRETX\r\n:::\r\n"],
  ["lone CR line endings", ":::secret\rSECRETX\r:::\r"],
  ["tab indent", "\t:::secret\nSECRETX\n:::"],
  ["tab after the colons", ":::\tsecret\nSECRETX\n:::"],
  ["spaces after the colons", ":::   secret\nSECRETX\n:::"],
  ["inside a real fence", "```\n:::secret\nSECRETX\n:::\n```"],
  ["after an unterminated info-string fence", "~~~ `\n:::secret\nSECRETX\n:::"],
  ["unclosed block", "visible\n\n:::secret\nSECRETX"],
  ["nested in a callout", ":::info\n:::secretive\nSECRETX\n:::\n:::"],
  [
    "fence with colons inside a secret",
    ":::secret\n```\n:::\nSECRETX\n```\n:::",
  ],
  ["heading inside a secret", "# H\n:::secret\n## Hidden SECRETX\n:::\n"],
  [
    "secret after a fence closes in a comment",
    "<!--\n```\n```\n-->\n:::secret\nSECRETX\n:::",
  ],
];

describe("secret blocks fail closed for guests", () => {
  it.each(SECRET_CASES)("%s", (_name, md) => {
    expect(renderMarkdown(md, { audience: "guest" })).not.toContain(MARK);
    expect(
      renderMarkdown(md, { audience: "member", includeSecrets: false }),
    ).toContain(MARK);
    expect(extractPlainText(md)).not.toContain(MARK);
    expect(JSON.stringify(extractHeadings(md))).not.toContain(MARK);
  });

  it("content after a closed secret stays visible", () => {
    const html = renderMarkdown(
      "vorher\n\n:::secret\nSECRETX\n:::\n\nnachher",
      { audience: "guest" },
    );
    expect(html).toContain("vorher");
    expect(html).toContain("nachher");
    expect(html).not.toContain(MARK);
  });

  it("content after a secret that sat inside a fence is still rendered", () => {
    const html = renderMarkdown(
      "<div>\n```\n:::secret\nSECRETX\n:::\nnachher",
      {
        audience: "guest",
      },
    );
    expect(html).toContain("nachher");
    expect(html).not.toContain(MARK);
  });

  it("a closing marker inside a fence that started inside the secret does not end it", () => {
    const html = renderMarkdown(
      ":::secret\n~~~\n:::\nSECRETX\n~~~\nSECRETX2\n:::\n\nnachher",
      { audience: "guest" },
    );
    expect(html).not.toContain("SECRETX");
    expect(html).toContain("nachher");
  });
});

describe("secret blocks for members", () => {
  const member = { audience: "member" as const };

  it("renders :::secret in any case as a wrapped block", () => {
    for (const md of [":::secret\nSECRETX\n:::", ":::SECRET\nSECRETX\n:::"]) {
      const html = renderMarkdown(md, member);
      expect(html).toContain('<div class="secret">');
      expect(html).toContain(MARK);
    }
  });

  it("keeps lookalike names transparent and fences literal, as before", () => {
    const secretive = renderMarkdown(":::secretive\nSECRETX\n:::", member);
    expect(secretive).toContain(MARK);
    expect(secretive).not.toContain('class="secret"');
    const fenced = renderMarkdown("```\n:::secret\nSECRETX\n:::\n```", member);
    expect(fenced).toContain(":::secret");
    expect(fenced).not.toContain('class="secret"');
  });

  it("includeSecrets shows the same as the member audience in plain text and headings", () => {
    const md = ":::secret\n## SECRETX\n:::";
    expect(extractPlainText(md, { includeSecrets: true })).toContain(MARK);
    expect(extractHeadings(md, { includeSecrets: true })).toHaveLength(1);
  });
});
