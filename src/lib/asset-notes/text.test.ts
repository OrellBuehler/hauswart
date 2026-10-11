import { describe, expect, it } from "vitest";
import { formatNotesList, noteExcerpt } from "./text";

describe("formatNotesList", () => {
  it("is a heading and one dashed line per note, in the order given", () => {
    expect(
      formatNotesList("Familienauto – Anliegen", [
        "Bremsen quietschen",
        "Reifendruck prüfen",
      ]),
    ).toBe(
      "Familienauto – Anliegen\n- Bremsen quietschen\n- Reifendruck prüfen",
    );
  });

  it("keeps the lines of a longer note, indented under its dash and without trailing spaces on blank lines", () => {
    expect(
      formatNotesList("Liste", [
        "Geräusch vorne links\nnur bei Kälte\n\nauch am Morgen",
      ]),
    ).toBe(
      "Liste\n- Geräusch vorne links\n  nur bei Kälte\n\n  auch am Morgen",
    );
  });

  it("reads Windows and old Mac line breaks like any other", () => {
    expect(formatNotesList("Liste", ["eins\r\nzwei\rdrei"])).toBe(
      "Liste\n- eins\n  zwei\n  drei",
    );
  });

  it("trims each note and leaves blank ones out", () => {
    expect(formatNotesList("Liste", ["  a  ", "", "   ", "b\t"])).toBe(
      "Liste\n- a\n- b",
    );
  });

  it("is empty without a note: there is nothing to take along", () => {
    expect(formatNotesList("Liste", [])).toBe("");
    expect(formatNotesList("Liste", [" "])).toBe("");
  });

  it("keeps characters that are no special case for plain text", () => {
    expect(formatNotesList("Ü", ["Öl nachfüllen: 0.5 l – «bald»"])).toBe(
      "Ü\n- Öl nachfüllen: 0.5 l – «bald»",
    );
  });
});

describe("noteExcerpt", () => {
  it("is the first line of the note", () => {
    expect(noteExcerpt("Bremsen quietschen\nvorne links")).toBe(
      "Bremsen quietschen",
    );
  });

  it("cuts a long line with an ellipsis, within the limit", () => {
    const text = noteExcerpt("x".repeat(100), 10);
    expect(text).toBe(`${"x".repeat(9)}…`);
    expect([...text]).toHaveLength(10);
  });

  it("leaves a line that fits alone and copes with whitespace", () => {
    expect(noteExcerpt("  kurz  ")).toBe("kurz");
    expect(noteExcerpt("")).toBe("");
    expect(noteExcerpt("\n\nspäter")).toBe("später");
  });
});
