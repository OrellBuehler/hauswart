/** A note's text as one line for a label or an aria text: the first line, cut to `max` characters with an ellipsis. */
export function noteExcerpt(body: string, max = 60): string {
  const first = body.trim().split(/\r?\n/, 1)[0]?.trim() ?? "";
  return first.length > max ? `${first.slice(0, max - 1).trimEnd()}…` : first;
}

/**
 * The open notes as a plain-text list to take to the garage: a heading and one `- ` line per note.
 * A note with several lines keeps them, the following lines indented to line up under the first.
 * Without notes the list is empty (nothing to take along), not just a heading.
 */
export function formatNotesList(
  heading: string,
  bodies: readonly string[],
): string {
  const items = bodies
    .map((body) => body.replace(/\r\n?/g, "\n").trim())
    .filter((body) => body !== "")
    .map((body) =>
      body
        .split("\n")
        .map((line, index) => {
          if (index === 0) return `- ${line.trimEnd()}`;
          return line.trim() === "" ? "" : `  ${line.trimEnd()}`;
        })
        .join("\n"),
    );
  return items.length === 0 ? "" : [heading, ...items].join("\n");
}
