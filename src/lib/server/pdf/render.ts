import { createRequire } from "node:module";
import path from "node:path";
import type {
  Content,
  ContentTable,
  TableCell,
  TDocumentDefinitions,
} from "pdfmake/interfaces";

const require = createRequire(import.meta.url);
const pdfmake = require("pdfmake");

let fontsReady = false;

function ensureFonts() {
  if (fontsReady) return;
  const dir = path.join(
    path.dirname(require.resolve("pdfmake/package.json")),
    "fonts",
    "Roboto",
  );
  pdfmake.addFonts({
    Roboto: {
      normal: path.join(dir, "Roboto-Regular.ttf"),
      bold: path.join(dir, "Roboto-Medium.ttf"),
      italics: path.join(dir, "Roboto-Italic.ttf"),
      bolditalics: path.join(dir, "Roboto-MediumItalic.ttf"),
    },
  });
  // Documents embed no images: deny all network access and any file outside the fonts.
  pdfmake.setUrlAccessPolicy(() => false);
  pdfmake.setLocalAccessPolicy((file: string) =>
    path.resolve(file).startsWith(dir + path.sep),
  );
  fontsReady = true;
}

export const MUTED = "#52525b";
const GRID = "#d4d4d8";

export const tableLayout = {
  hLineWidth: (i: number, node: { table: { body: unknown[] } }) =>
    i === 0 || i === node.table.body.length ? 0 : 0.5,
  vLineWidth: () => 0,
  hLineColor: () => GRID,
  paddingTop: () => 4,
  paddingBottom: () => 4,
};

export const headerCell = (text: string): TableCell => ({
  text,
  bold: true,
  fontSize: 9,
  color: MUTED,
});

export function table(
  widths: ContentTable["table"]["widths"],
  body: TableCell[][],
): ContentTable {
  return {
    table: { headerRows: 1, widths, body },
    layout: tableLayout as never,
    fontSize: 9,
  };
}

export type PdfContent = Content;

/** A fixed instant for a `YYYY-MM-DD` date, so the same input always yields the same file. */
const instantOf = (date: string) => new Date(`${date}T00:00:00.000Z`);

export interface PdfMeta {
  title: string;
  /** `YYYY-MM-DD`; stands in for the wall clock (also the creation date). */
  generatedOn: string;
  footerLeft: string;
  footerPage: (page: number, pages: number) => string;
}

/** Renders an A4 document definition to PDF bytes; the output depends only on its inputs. */
export async function renderPdf(
  definition: Omit<TDocumentDefinitions, "footer" | "info" | "defaultStyle">,
  meta: PdfMeta,
): Promise<Uint8Array<ArrayBuffer>> {
  ensureFonts();
  const doc: TDocumentDefinitions = {
    pageSize: "A4",
    pageMargins: [40, 40, 40, 50],
    ...definition,
    defaultStyle: { font: "Roboto", fontSize: 10 },
    info: {
      title: meta.title,
      author: "hauswart",
      creator: "hauswart",
      producer: "hauswart",
      creationDate: instantOf(meta.generatedOn),
    },
    footer: (page: number, pages: number) => ({
      columns: [
        { text: meta.footerLeft, alignment: "left" },
        { text: meta.footerPage(page, pages), alignment: "right" },
      ],
      fontSize: 8,
      color: MUTED,
      margin: [40, 16, 40, 0],
    }),
  };
  return new Uint8Array(await pdfmake.createPdf(doc).getBuffer());
}
