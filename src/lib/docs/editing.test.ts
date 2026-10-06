import { describe, expect, it } from "vitest";
import {
  continueList,
  insertBlock,
  insertLink,
  insertText,
  setHeading,
  toggleBullet,
  toggleNumbered,
  toggleTask,
  wrapSelection,
  type Edit,
} from "./editing";

function apply(value: string, e: Edit): { text: string; selected: string } {
  const text = value.slice(0, e.from) + e.insert + value.slice(e.to);
  return { text, selected: text.slice(e.selectFrom, e.selectTo) };
}

describe("wrapSelection", () => {
  it("wraps the selection and keeps it selected", () => {
    const result = apply(
      "a word b",
      wrapSelection("a word b", 2, 6, "**", "**", "text"),
    );
    expect(result.text).toBe("a **word** b");
    expect(result.selected).toBe("word");
  });

  it("inserts a placeholder without a selection", () => {
    const result = apply("", wrapSelection("", 0, 0, "*", "*", "text"));
    expect(result.text).toBe("*text*");
    expect(result.selected).toBe("text");
  });

  it("unwraps an already wrapped selection", () => {
    const value = "a **word** b";
    const result = apply(value, wrapSelection(value, 4, 8, "**", "**", "text"));
    expect(result.text).toBe("a word b");
    expect(result.selected).toBe("word");
  });
});

describe("list toggles", () => {
  it("prefixes every selected line and removes the prefix again", () => {
    const value = "one\ntwo\nthree";
    const first = apply(value, toggleBullet(value, 0, 7));
    expect(first.text).toBe("- one\n- two\nthree");
    const second = apply(first.text, toggleBullet(first.text, 0, 11));
    expect(second.text).toBe("one\ntwo\nthree");
  });

  it("switches between list types", () => {
    const value = "- one\n- two";
    expect(apply(value, toggleNumbered(value, 0, value.length)).text).toBe(
      "1. one\n2. two",
    );
    expect(apply(value, toggleTask(value, 0, value.length)).text).toBe(
      "- [ ] one\n- [ ] two",
    );
  });

  it("puts the cursor behind the prefix of a single line", () => {
    const e = toggleBullet("abc", 1, 1);
    expect(apply("abc", e).text).toBe("- abc");
    expect(e.selectFrom).toBe(5);
  });
});

describe("setHeading", () => {
  it("sets, switches and removes a heading", () => {
    expect(apply("Title", setHeading("Title", 2, 2)).text).toBe("## Title");
    expect(apply("## Title", setHeading("## Title", 2, 3)).text).toBe(
      "### Title",
    );
    expect(apply("## Title", setHeading("## Title", 2, 2)).text).toBe("Title");
  });
});

describe("insertLink", () => {
  it("selects the url after the link text", () => {
    const result = apply(
      "see docs",
      insertLink("see docs", 4, 8, "text", "https://"),
    );
    expect(result.text).toBe("see [docs](https://)");
    expect(result.selected).toBe("https://");
  });

  it("uses a pasted url as the target", () => {
    const value = "https://example.org/x";
    const result = apply(
      value,
      insertLink(value, 0, value.length, "text", "https://"),
    );
    expect(result.text).toBe("[text](https://example.org/x)");
    expect(result.selected).toBe("text");
  });
});

describe("insertBlock", () => {
  it("surrounds the block with blank lines", () => {
    const value = "intro\nmore";
    const result = apply(
      value,
      insertBlock(value, 5, 5, "secret", "code 1234"),
    );
    expect(result.text).toBe("intro\n\n:::secret\ncode 1234\n:::\n\nmore");
    expect(result.selected).toBe("code 1234");
  });

  it("wraps the selection", () => {
    const result = apply(
      "pin 1234",
      insertBlock("pin 1234", 0, 8, "warning", "x"),
    );
    expect(result.text).toBe(":::warning\npin 1234\n:::\n");
  });
});

describe("insertText", () => {
  it("puts block text on its own line", () => {
    const value = "a b";
    const result = apply(
      value,
      insertText(value, 1, 1, "![x](attachment:1)", true),
    );
    expect(result.text).toBe("a\n\n![x](attachment:1)\n\n b");
  });
});

describe("continueList", () => {
  it("continues bullets, tasks and numbers", () => {
    expect(apply("- a", continueList("- a", 3, 3)!).text).toBe("- a\n- ");
    expect(apply("- [x] a", continueList("- [x] a", 7, 7)!).text).toBe(
      "- [x] a\n- [ ] ",
    );
    expect(apply("1. a", continueList("1. a", 4, 4)!).text).toBe("1. a\n2. ");
  });

  it("ends the list on an empty item", () => {
    expect(apply("- a\n- ", continueList("- a\n- ", 6, 6)!).text).toBe("- a\n");
  });

  it("leaves other lines alone", () => {
    expect(continueList("text", 4, 4)).toBeNull();
    expect(continueList("- a", 0, 3)).toBeNull();
  });
});
