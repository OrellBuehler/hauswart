import { describe, expect, it } from "vitest";
import { opensKeyboard } from "./text-entry";

describe("opensKeyboard", () => {
  it.each(["text", "search", "email", "tel", "url", "password", "number"])(
    "is true for an input of type %s",
    (type) => {
      expect(opensKeyboard({ tagName: "INPUT", type })).toBe(true);
    },
  );

  it("is true for an input without a type, a text area and an editable region", () => {
    expect(opensKeyboard({ tagName: "INPUT" })).toBe(true);
    expect(opensKeyboard({ tagName: "TEXTAREA" })).toBe(true);
    expect(opensKeyboard({ tagName: "DIV", isContentEditable: true })).toBe(
      true,
    );
  });

  it.each([
    "checkbox",
    "radio",
    "button",
    "submit",
    "file",
    "range",
    "color",
    "date",
    "time",
  ])("is false for an input of type %s", (type) => {
    expect(opensKeyboard({ tagName: "INPUT", type })).toBe(false);
  });

  it("is false for everything else", () => {
    expect(opensKeyboard(null)).toBe(false);
    expect(opensKeyboard(undefined)).toBe(false);
    expect(opensKeyboard({})).toBe(false);
    expect(opensKeyboard({ tagName: "BUTTON" })).toBe(false);
    expect(opensKeyboard({ tagName: "SELECT" })).toBe(false);
    expect(opensKeyboard({ tagName: "DIV", isContentEditable: false })).toBe(
      false,
    );
    expect(
      opensKeyboard({ tagName: "INPUT", type: "text", readOnly: true }),
    ).toBe(false);
  });
});
