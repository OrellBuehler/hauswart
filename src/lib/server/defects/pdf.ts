import type { DefectSeverity, DefectStatus, UserLocale } from "$lib/api/enums";
import { m } from "$lib/paraglide/messages";
import { rooms } from "$lib/server/db";
import { eq } from "drizzle-orm";
import { householdTimeZone } from "$lib/server/config";
import { getHousehold } from "$lib/server/household/household";
import {
  headerCell,
  MUTED,
  renderPdf,
  table,
  type PdfContent,
} from "$lib/server/pdf/render";
import type { ServiceContext } from "$lib/server/service";
import { clockAt } from "$lib/server/tasks/evaluator";
import type { Viewer } from "$lib/server/comments/comments";
import {
  getTimeline,
  selectAllDefects,
  type DefectFilter,
  type DefectRecord,
  type TimelineItem,
} from "./defects";

type Opts = { locale: UserLocale };

const STATUS: Record<DefectStatus, (i: object, o: Opts) => string> = {
  open: m.defect_pdf_status_open,
  reported: m.defect_pdf_status_reported,
  in_progress: m.defect_pdf_status_in_progress,
  fixed: m.defect_pdf_status_fixed,
  rejected: m.defect_pdf_status_rejected,
};
const SEVERITY: Record<DefectSeverity, (i: object, o: Opts) => string> = {
  low: m.defect_pdf_severity_low,
  medium: m.defect_pdf_severity_medium,
  high: m.defect_pdf_severity_high,
};

const INTL_LOCALE: Record<UserLocale, string> = { de: "de-CH", en: "en-GB" };

function formatDate(date: string | null, locale: UserLocale): string {
  if (!date) return "–";
  return new Intl.DateTimeFormat(INTL_LOCALE[locale], {
    timeZone: "UTC",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(new Date(`${date}T00:00:00.000Z`));
}

/** Markdown reads fine as plain text once the markers are gone. */
export function plainText(markdown: string): string {
  return markdown
    .replace(/```[^\n]*\n?/g, "")
    .replace(/^\s{0,3}#{1,6}\s+/gm, "")
    .replace(/!?\[([^\]]*)\]\(([^)]*)\)/g, "$1 ($2)")
    .replace(/(\*\*|__|\*|_|`|~~)/g, "")
    .replace(/^\s*>\s?/gm, "")
    .trim();
}

export interface ExportInput {
  filter: Pick<DefectFilter, "status" | "roomId">;
  locale: UserLocale;
}

function filterLabel(
  ctx: Pick<ServiceContext, "db">,
  filter: ExportInput["filter"],
  locale: UserLocale,
): string | null {
  const parts: string[] = [];
  if (filter.status) parts.push(STATUS[filter.status]({}, { locale }));
  if (filter.roomId) {
    const room = ctx.db
      .select({ name: rooms.name })
      .from(rooms)
      .where(eq(rooms.id, filter.roomId))
      .get();
    if (room) parts.push(room.name);
  }
  return parts.length > 0 ? parts.join(", ") : null;
}

/** A clean A4 defect list: overview table, then each defect with its history. */
export async function exportDefectsPdf(
  ctx: ServiceContext,
  input: ExportInput,
): Promise<Uint8Array<ArrayBuffer>> {
  const { locale } = input;
  const o: Opts = { locale };
  const today = clockAt(ctx.now).today;
  const tz = householdTimeZone();
  const household = getHousehold(ctx);
  const rows = selectAllDefects(ctx, input.filter);
  const viewer: Viewer = { id: "", role: "member" };
  const stamp = new Intl.DateTimeFormat(INTL_LOCALE[locale], {
    timeZone: tz,
    dateStyle: "short",
    timeStyle: "short",
  });

  const location = (d: DefectRecord): PdfContent => ({
    stack: [
      ...(d.roomName ? [{ text: d.roomName }] : []),
      ...(d.assetName ? [{ text: d.assetName, color: MUTED }] : []),
      ...(!d.roomName && !d.assetName ? [{ text: "–" }] : []),
    ],
  });

  const overview = table(
    [26, 80, "*", 50, 50, 50, 56],
    [
      [
        headerCell(m.defect_pdf_col_nr({}, o)),
        headerCell(m.defect_pdf_col_location({}, o)),
        headerCell(m.defect_pdf_col_description({}, o)),
        headerCell(m.defect_pdf_col_discovered({}, o)),
        headerCell(m.defect_pdf_col_reported({}, o)),
        headerCell(m.defect_pdf_col_deadline({}, o)),
        headerCell(m.defect_pdf_col_status({}, o)),
      ],
      ...rows.map((d) => [
        { text: String(d.number) },
        location(d),
        { text: d.title, bold: true },
        { text: formatDate(d.discoveredOn, locale) },
        { text: formatDate(d.reportedOn, locale) },
        { text: formatDate(d.deadlineDate, locale) },
        { text: STATUS[d.status]({}, o) },
      ]),
    ],
  );

  const describeEvent = (item: TimelineItem): string => {
    if (item.kind === "comment") {
      return item.deleted
        ? `${m.defect_pdf_comment({}, o)}: ${m.defect_pdf_comment_deleted({}, o)}`
        : `${m.defect_pdf_comment({}, o)}: ${plainText(item.bodyMd)}`;
    }
    const note = item.bodyMd ? plainText(item.bodyMd) : "";
    if (item.type === "created") return m.defect_pdf_event_created({}, o);
    if (item.type === "status") {
      const line = m.defect_pdf_event_status(
        {
          from: item.fromStatus ? STATUS[item.fromStatus]({}, o) : "–",
          to: item.toStatus ? STATUS[item.toStatus]({}, o) : "–",
        },
        o,
      );
      return note ? `${line}. ${note}` : line;
    }
    return `${m.defect_pdf_event_correspondence({}, o)}: ${note}`;
  };

  const field = (label: string, value: string | null): PdfContent[] =>
    value
      ? [
          {
            columns: [
              { text: label, width: 90, color: MUTED },
              { text: value, width: "*" },
            ],
            margin: [0, 1, 0, 0],
          },
        ]
      : [];

  const details: PdfContent[] = rows.flatMap((d) => {
    const timeline = getTimeline(ctx, viewer, d.id);
    const deadline = d.deadlineDate
      ? d.deadlineSource === "handover"
        ? m.defect_pdf_deadline_from_handover(
            { date: formatDate(d.deadlineDate, locale) },
            o,
          )
        : formatDate(d.deadlineDate, locale)
      : null;
    return [
      {
        text: m.defect_pdf_heading({ number: d.number, title: d.title }, o),
        fontSize: 12,
        bold: true,
        margin: [0, 18, 0, 4],
        keepWithNext: true,
      },
      ...field(m.defect_pdf_col_status({}, o), STATUS[d.status]({}, o)),
      ...field(m.defect_pdf_severity({}, o), SEVERITY[d.severity]({}, o)),
      ...field(
        m.defect_pdf_col_location({}, o),
        [d.roomName, d.assetName].filter(Boolean).join(" / ") || null,
      ),
      ...field(m.defect_pdf_location_detail({}, o), d.locationDetail),
      ...field(m.defect_pdf_responsible({}, o), d.responsibleContactName),
      ...field(
        m.defect_pdf_col_discovered({}, o),
        formatDate(d.discoveredOn, locale),
      ),
      ...field(
        m.defect_pdf_col_reported({}, o),
        d.reportedOn ? formatDate(d.reportedOn, locale) : null,
      ),
      ...field(m.defect_pdf_col_deadline({}, o), deadline),
      ...field(
        m.defect_pdf_fixed_on({}, o),
        d.fixedOn ? formatDate(d.fixedOn, locale) : null,
      ),
      ...(d.descriptionMd.trim()
        ? [
            {
              text: plainText(d.descriptionMd),
              margin: [0, 6, 0, 0] as [number, number, number, number],
            },
          ]
        : []),
      ...(d.resolutionMd.trim()
        ? [
            {
              text: m.defect_pdf_resolution({}, o),
              bold: true,
              margin: [0, 6, 0, 0] as [number, number, number, number],
            },
            { text: plainText(d.resolutionMd) },
          ]
        : []),
      {
        text: m.defect_pdf_history({}, o),
        bold: true,
        margin: [0, 8, 0, 2],
        keepWithNext: true,
      },
      table(
        [86, 80, "*"],
        timeline.map((item) => [
          { text: stamp.format(item.at), color: MUTED },
          { text: item.userName ?? "–", color: MUTED },
          { text: describeEvent(item) },
        ]),
      ),
    ] as PdfContent[];
  });

  const filter = filterLabel(ctx, input.filter, locale);
  const content: PdfContent[] = [
    { text: m.defect_pdf_title({}, o), fontSize: 18, bold: true },
    { text: household.name, fontSize: 10, color: MUTED, margin: [0, 2, 0, 0] },
    ...(filter
      ? [
          {
            text: m.defect_pdf_filter({ filter }, o),
            fontSize: 9,
            color: MUTED,
          } as PdfContent,
        ]
      : []),
    { text: "", margin: [0, 6, 0, 0] },
    ...(rows.length === 0
      ? [
          {
            text: m.defect_pdf_empty({}, o),
            margin: [0, 12, 0, 0],
          } as PdfContent,
        ]
      : [overview, ...details]),
  ];

  return renderPdf(
    { content },
    {
      title: m.defect_pdf_title({}, o),
      generatedOn: today,
      footerLeft: m.defect_pdf_generated(
        { date: formatDate(today, locale) },
        o,
      ),
      footerPage: (page, pages) => m.defect_pdf_page({ page, pages }, o),
    },
  );
}
