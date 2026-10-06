/**
 * Pure text edits for the markdown editor. Each function takes the textarea's value and
 * selection and returns an `Edit`: replace `[from, to)` with `insert`, then select
 * `[selectFrom, selectTo)` (offsets in the new text). The editor applies it through the
 * browser's own editing command so undo keeps working.
 */
export interface Edit {
  from: number;
  to: number;
  insert: string;
  selectFrom: number;
  selectTo: number;
}

function edit(
  from: number,
  to: number,
  insert: string,
  selectFrom: number,
  selectTo = selectFrom,
): Edit {
  return { from, to, insert, selectFrom, selectTo };
}

/** Wraps the selection in `before`/`after`; an already wrapped selection is unwrapped. */
export function wrapSelection(
  value: string,
  start: number,
  end: number,
  before: string,
  after: string,
  placeholder: string,
): Edit {
  const selected = value.slice(start, end);
  if (
    start >= before.length &&
    value.slice(start - before.length, start) === before &&
    value.slice(end, end + after.length) === after
  ) {
    return edit(
      start - before.length,
      end + after.length,
      selected,
      start - before.length,
      start - before.length + selected.length,
    );
  }
  const text = selected || placeholder;
  const from = start + before.length;
  return edit(start, end, `${before}${text}${after}`, from, from + text.length);
}

function lineStart(value: string, index: number): number {
  return value.lastIndexOf("\n", index - 1) + 1;
}

function lineEnd(value: string, index: number): number {
  const at = value.indexOf("\n", index);
  return at === -1 ? value.length : at;
}

const LIST_MARKER = /^(\s*)(?:[-*+] \[[ xX]\] |[-*+] |\d{1,9}[.)] )/;
const HEADING_MARKER = /^#{1,6} /;

/**
 * Prefixes every line touched by the selection. When all of them already start with the
 * prefix, it is removed again. `strip` removes a conflicting marker (e.g. another list type).
 */
export function togglePrefix(
  value: string,
  start: number,
  end: number,
  prefix: string,
  strip: RegExp = /^$/,
): Edit {
  const from = lineStart(value, start);
  const to = lineEnd(
    value,
    end > start && value[end - 1] === "\n" ? end - 1 : end,
  );
  const lines = value.slice(from, to).split("\n");
  const all = lines.every((line) => line.startsWith(prefix));
  const next = lines.map((line) => {
    if (all) return line.slice(prefix.length);
    const bare = line.replace(strip, "");
    return line.trim() === "" && lines.length > 1 ? line : `${prefix}${bare}`;
  });
  const insert = next.join("\n");
  const cursor =
    start === end && lines.length === 1 ? from + insert.length : -1;
  return edit(
    from,
    to,
    insert,
    cursor === -1 ? from : cursor,
    cursor === -1 ? from + insert.length : cursor,
  );
}

export function toggleBullet(value: string, start: number, end: number): Edit {
  return togglePrefix(value, start, end, "- ", LIST_MARKER);
}

export function toggleNumbered(
  value: string,
  start: number,
  end: number,
): Edit {
  const from = lineStart(value, start);
  const to = lineEnd(value, end);
  const lines = value.slice(from, to).split("\n");
  const numbered = lines.every((line) => /^\d{1,9}[.)] /.test(line));
  const next = lines.map((line, index) =>
    numbered
      ? line.replace(/^\d{1,9}[.)] /, "")
      : `${index + 1}. ${line.replace(LIST_MARKER, "")}`,
  );
  const insert = next.join("\n");
  return edit(from, to, insert, from, from + insert.length);
}

export function toggleTask(value: string, start: number, end: number): Edit {
  return togglePrefix(value, start, end, "- [ ] ", LIST_MARKER);
}

/** Sets the heading level (0 removes it) of the line at the cursor; the same level again removes it. */
export function setHeading(value: string, start: number, level: 2 | 3): Edit {
  const from = lineStart(value, start);
  const to = lineEnd(value, start);
  const line = value.slice(from, to);
  const prefix = `${"#".repeat(level)} `;
  const bare = line.replace(HEADING_MARKER, "");
  const insert = line.startsWith(prefix) ? bare : `${prefix}${bare}`;
  return edit(from, to, insert, from + insert.length);
}

/** `[selection](url)` with the url selected, or the url as the link text when the selection is one. */
export function insertLink(
  value: string,
  start: number,
  end: number,
  placeholderText: string,
  placeholderUrl: string,
): Edit {
  const selected = value.slice(start, end);
  if (/^https?:\/\/\S+$/.test(selected)) {
    const insert = `[${placeholderText}](${selected})`;
    return edit(
      start,
      end,
      insert,
      start + 1,
      start + 1 + placeholderText.length,
    );
  }
  const text = selected || placeholderText;
  const insert = `[${text}](${placeholderUrl})`;
  const urlFrom = start + text.length + 3;
  return edit(
    start,
    end,
    insert,
    selected ? urlFrom : start + 1,
    selected ? urlFrom + placeholderUrl.length : start + 1 + text.length,
  );
}

/** A `:::kind` block around the selection, set off from the text around it by blank lines. */
export function insertBlock(
  value: string,
  start: number,
  end: number,
  kind: "secret" | "warning" | "info",
  placeholder: string,
): Edit {
  const selected = value.slice(start, end).replace(/^\n+|\n+$/g, "");
  const body = selected || placeholder;
  const head = `:::${kind}\n`;
  const before =
    start === 0
      ? ""
      : value[start - 1] === "\n"
        ? start > 1 && value[start - 2] === "\n"
          ? ""
          : "\n"
        : "\n\n";
  const after =
    end >= value.length
      ? "\n"
      : value[end] === "\n"
        ? value[end + 1] === "\n"
          ? ""
          : "\n"
        : "\n\n";
  const insert = `${before}${head}${body}\n:::${after}`;
  const bodyFrom = start + before.length + head.length;
  return edit(start, end, insert, bodyFrom, bodyFrom + body.length);
}

/** Inserts text at the selection, on its own lines when `block` is set. */
export function insertText(
  value: string,
  start: number,
  end: number,
  text: string,
  block = false,
): Edit {
  let insert = text;
  if (block) {
    const before = start === 0 || value[start - 1] === "\n" ? "" : "\n\n";
    const after = end >= value.length || value[end] === "\n" ? "" : "\n\n";
    insert = `${before}${text}${after}`;
    const caret = start + insert.length - after.length;
    return edit(start, end, insert, caret);
  }
  return edit(start, end, insert, start + insert.length);
}

/**
 * Enter at the end of a list item starts the next item (`- `, `- [ ] `, `1. `); Enter on an
 * empty item ends the list. Returns null when the line is not a list item.
 */
export function continueList(
  value: string,
  start: number,
  end: number,
): Edit | null {
  if (start !== end) return null;
  const from = lineStart(value, start);
  const lineFull = value.slice(from, lineEnd(value, start));
  const match = /^(\s*)(?:([-*+]) (\[[ xX]\] )?|(\d{1,9})([.)]) )/.exec(
    lineFull,
  );
  if (!match) return null;
  const marker = match[0];
  if (start < from + marker.length) return null;
  const rest = lineFull.slice(marker.length);
  if (rest.trim() === "" && start === from + lineFull.length) {
    return edit(from, from + lineFull.length, "", from);
  }
  const indent = match[1] ?? "";
  const next =
    match[4] !== undefined
      ? `${indent}${Number(match[4]) + 1}${match[5]} `
      : `${indent}${match[2]} ${match[3] ? "[ ] " : ""}`;
  const insert = `\n${next}`;
  return edit(start, start, insert, start + insert.length);
}
