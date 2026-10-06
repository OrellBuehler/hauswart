export interface ParsedEvent {
  uid: string;
  summary: string;
  description: string;
  start: string;
  end: string;
  status: string;
  sequence: number;
  url: string;
  categories: string;
  trigger: string | null;
  dtstamp: string;
}

const unescapeText = (value: string) =>
  value.replace(/\\n/g, "\n").replace(/\\([,;\\])/g, "$1");

/** Just enough of an iCalendar reader for tests: unfolds lines and reads the VEVENTs. */
export function parseIcs(ics: string): {
  name: string;
  events: ParsedEvent[];
} {
  const lines = ics.replace(/\r\n[ \t]/g, "").split("\r\n");
  const events: ParsedEvent[] = [];
  let current: Record<string, string> | null = null;
  let name = "";
  for (const line of lines) {
    if (line === "BEGIN:VEVENT") current = {};
    else if (line === "END:VEVENT" && current) {
      events.push({
        uid: current.UID ?? "",
        summary: unescapeText(current.SUMMARY ?? ""),
        description: unescapeText(current.DESCRIPTION ?? ""),
        start: current["DTSTART;VALUE=DATE"] ?? "",
        end: current["DTEND;VALUE=DATE"] ?? "",
        status: current.STATUS ?? "",
        sequence: Number(current.SEQUENCE ?? "-1"),
        url: current.URL ?? "",
        categories: unescapeText(current.CATEGORIES ?? ""),
        trigger: current.TRIGGER ?? null,
        dtstamp: current.DTSTAMP ?? "",
      });
      current = null;
    } else if (current) {
      const colon = line.indexOf(":");
      const key = line.slice(0, colon);
      // The first DESCRIPTION is the event's; the alarm repeats it.
      if (!(key in current)) current[key] = line.slice(colon + 1);
    } else if (line.startsWith("X-WR-CALNAME:")) {
      name = unescapeText(line.slice("X-WR-CALNAME:".length));
    }
  }
  return { name, events };
}
