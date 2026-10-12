import { describe, expect, it } from "vitest";
import { render } from "svelte/server";
import { AI_TASK_PDF_READ_MAX_BYTES } from "$lib/api/schemas/ai-tasks";
import ReceiptPicker from "./receipt-picker.svelte";

const file = (name: string, type: string, size: number) =>
  new File([new Uint8Array(size)], name, { type });

const html = (props: Record<string, unknown>) =>
  render(ReceiptPicker as never, {
    props: { id: "r", ...props } as never,
  }).body.replace(/[\u00a0\u202f]/g, " ");

const big = () =>
  file("gross.pdf", "application/pdf", AI_TASK_PDF_READ_MAX_BYTES + 1);

describe("the receipt picker", () => {
  it("warns about a PDF above 4 MB where an assistant reads the receipt", () => {
    const body = html({ file: big(), warnLargePdf: true });
    expect(body).toContain("gross.pdf");
    expect(body).toContain("kann über die MCP-Verbindung nicht gelesen werden");
  });

  it("says nothing where the file only becomes the receipt of an entry", () => {
    expect(html({ file: big() })).not.toContain("MCP-Verbindung");
  });

  it("says nothing about a small PDF or a photo", () => {
    for (const small of [
      file("klein.pdf", "application/pdf", 1000),
      file("foto.jpg", "image/jpeg", AI_TASK_PDF_READ_MAX_BYTES * 2),
    ]) {
      expect(html({ file: small, warnLargePdf: true })).not.toContain(
        "MCP-Verbindung",
      );
    }
  });
});
