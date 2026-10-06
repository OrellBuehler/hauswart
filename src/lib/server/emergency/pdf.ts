import type { UserLocale } from "$lib/api/enums";
import { m } from "$lib/paraglide/messages";
import { householdTimeZone } from "$lib/server/config";
import { decodeEntities } from "$lib/server/docs/markdown-core";
import { renderMarkdownAsync } from "$lib/server/docs/markdown";
import {
  headerCell,
  MUTED,
  renderPdf,
  table,
  type PdfContent,
} from "$lib/server/pdf/render";
import type { ServiceContext } from "$lib/server/service";
import { clockAt } from "$lib/server/tasks/evaluator";
import { getEmergency } from "./emergency";

const INTL_LOCALE: Record<UserLocale, string> = { de: "de-CH", en: "en-GB" };
const keepNext = (content: PdfContent): PdfContent =>
  ({ ...(content as object), keepWithNext: true }) as unknown as PdfContent;

const HEADING = "\u0001";
const END_HEADING = "\u0002";

/**
 * The sanitized HTML of one document as paragraphs of plain text: headings in bold, list items
 * with a bullet, table cells separated by bars. The HTML comes from the markdown renderer
 * (secret blocks already handled for the audience), so only its small tag set occurs.
 */
export function htmlToBlocks(html: string): PdfContent[] {
  const text = decodeEntities(
    html
      .replace(
        /<h[1-6][^>]*>([\s\S]*?)<\/h[1-6]>/gi,
        (_all, inner: string) => `\n\n${HEADING}${inner}${END_HEADING}\n\n`,
      )
      .replace(/<li[^>]*>/gi, "\n• ")
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/(td|th)>/gi, " | ")
      .replace(/<\/(p|div|ul|ol|table|tr|blockquote|pre)>/gi, "\n\n")
      .replace(/<[^>]+>/g, ""),
  );
  return text
    .split(/\n{2,}/)
    .map((part) => part.replace(/ \| $/gm, "").trim())
    .filter((part) => part.length > 0)
    .map((part): PdfContent => {
      if (part.startsWith(HEADING)) {
        return {
          text: part.replace(HEADING, "").replace(END_HEADING, "").trim(),
          bold: true,
          margin: [0, 6, 0, 2],
        };
      }
      return { text: part, margin: [0, 0, 0, 4] };
    });
}

export interface EmergencyPdfInput {
  locale: UserLocale;
  includeSecrets: boolean;
}

export interface EmergencyDocument {
  content: PdfContent[];
  today: string;
}

async function blocksOf(
  md: string,
  includeSecrets: boolean,
): Promise<PdfContent[]> {
  const html = await renderMarkdownAsync(md, {
    audience: includeSecrets ? "member" : "guest",
  });
  return htmlToBlocks(html);
}

/** The document definition, separate from the rendering so tests can read what goes on the sheet. */
export async function emergencyDocument(
  ctx: ServiceContext,
  input: EmergencyPdfInput,
): Promise<EmergencyDocument> {
  const o = { locale: input.locale };
  const { today } = clockAt(ctx.now);
  const record = getEmergency(ctx);
  const section = (title: string): PdfContent =>
    keepNext({ text: title, fontSize: 13, bold: true, margin: [0, 16, 0, 6] });
  const empty = (): PdfContent => ({
    text: m.emergency_pdf_empty({}, o),
    color: MUTED,
  });

  const content: PdfContent[] = [
    { text: m.emergency_pdf_title({}, o), fontSize: 18, bold: true },
    {
      text: record.householdName,
      fontSize: 10,
      color: MUTED,
      margin: [0, 2, 0, 0],
    },
  ];
  if (input.includeSecrets) {
    content.push({
      margin: [0, 10, 0, 0],
      table: {
        widths: ["*"],
        body: [
          [
            {
              stack: [
                {
                  text: m.emergency_pdf_confidential_title({}, o),
                  bold: true,
                  fontSize: 14,
                  color: "#b91c1c",
                },
                {
                  text: m.emergency_pdf_confidential_text({}, o),
                  color: "#b91c1c",
                  margin: [0, 2, 0, 0],
                },
              ],
              margin: [6, 6, 6, 6],
            },
          ],
        ],
      },
      layout: {
        hLineColor: () => "#b91c1c",
        vLineColor: () => "#b91c1c",
        hLineWidth: () => 1.5,
        vLineWidth: () => 1.5,
      },
    });
  }

  content.push(section(m.emergency_pdf_contacts({}, o)));
  content.push(
    record.contacts.length === 0
      ? empty()
      : table(
          [130, 110, 100, "*"],
          [
            [
              headerCell(m.emergency_pdf_col_name({}, o)),
              headerCell(m.emergency_pdf_col_company({}, o)),
              headerCell(m.emergency_pdf_col_phone({}, o)),
              headerCell(m.emergency_pdf_col_email({}, o)),
            ],
            ...record.contacts.map((c) => [
              { text: c.name, bold: true },
              { text: c.company ?? "–" },
              { text: c.phone ?? "–" },
              { text: c.email ?? "–" },
            ]),
          ],
        ),
  );

  content.push(section(m.emergency_pdf_places({}, o)));
  if (record.assets.length === 0) content.push(empty());
  for (const asset of record.assets) {
    content.push(
      keepNext({ text: asset.name, bold: true, margin: [0, 6, 0, 0] }),
    );
    if (asset.roomName) {
      content.push({
        text: m.emergency_pdf_in_room({ room: asset.roomName }, o),
        color: MUTED,
        fontSize: 9,
      });
    }
    for (const hint of asset.pinnedHints) {
      content.push({
        text: hint.title,
        bold: true,
        fontSize: 9,
        margin: [8, 3, 0, 0],
      });
      for (const block of await blocksOf(hint.bodyMd, input.includeSecrets)) {
        content.push({ stack: [block], margin: [8, 0, 0, 0] });
      }
    }
  }

  content.push(section(m.emergency_pdf_pages({}, o)));
  if (record.pages.length === 0) content.push(empty());
  for (const page of record.pages) {
    content.push(
      keepNext({
        text: page.title,
        fontSize: 12,
        bold: true,
        margin: [0, 10, 0, 3],
      }),
    );
    content.push(...(await blocksOf(page.bodyMd, input.includeSecrets)));
  }
  return { content, today };
}

export async function exportEmergencyPdf(
  ctx: ServiceContext,
  input: EmergencyPdfInput,
): Promise<Uint8Array<ArrayBuffer>> {
  const o = { locale: input.locale };
  const { content, today } = await emergencyDocument(ctx, input);
  const date = new Intl.DateTimeFormat(INTL_LOCALE[input.locale], {
    timeZone: householdTimeZone(),
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(new Date(ctx.now));
  const generated = m.emergency_pdf_generated({ date }, o);
  return renderPdf(
    { content },
    {
      title: m.emergency_pdf_title({}, o),
      generatedOn: today,
      footerLeft: input.includeSecrets
        ? `${m.emergency_pdf_confidential_footer({}, o)} · ${generated}`
        : generated,
      footerPage: (page, pages) => m.emergency_pdf_page({ page, pages }, o),
    },
  );
}
