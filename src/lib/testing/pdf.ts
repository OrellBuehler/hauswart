/** Just enough of a PDF reader for tests: header, trailer and the page count. */
export function pdfInfo(bytes: Uint8Array) {
  const text = Buffer.from(bytes).toString("latin1");
  const counts = [
    ...text.matchAll(/\/Type\s*\/Pages[\s\S]*?\/Count\s+(\d+)/g),
  ].map((m) => Number(m[1]));
  return {
    header: text.slice(0, 5),
    trailer: text.trimEnd().endsWith("%%EOF"),
    pageCount:
      counts.length > 0
        ? Math.max(...counts)
        : (text.match(/\/Type\s*\/Page\b/g) ?? []).length,
    text,
  };
}
