import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  fetchPickerItems,
  forgetPickerItems,
  loadAllPickerItems,
} from "./provider-lists";

let requests: string[];
let failNext: boolean;

function answer(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

beforeEach(() => {
  requests = [];
  failNext = false;
  forgetPickerItems();
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string) => {
      requests.push(input);
      if (failNext) {
        failNext = false;
        return answer({ error: { code: "upstream_error", message: "x" } }, 502);
      }
      if (input.includes("/tags")) {
        return answer({
          items: [
            { id: 1, name: "Apartment", color: null, documentCount: 3 },
            { id: 2, name: "Receipt", color: "#aabbcc", documentCount: null },
          ],
        });
      }
      if (input.includes("/custom-fields")) {
        return answer({
          items: [
            { id: 7, name: "Warranty until", dataType: "date" },
            { id: 9, name: "Amount", dataType: "monetary" },
          ],
        });
      }
      if (input.includes("/storage-paths")) {
        return answer({
          items: [{ id: 3, name: "Apartment", path: "apartment/{title}" }],
        });
      }
      if (input.includes("/groups")) {
        return answer({ items: [{ id: 50, name: "Household" }] });
      }
      return answer({
        items: [{ id: 20, name: "Example Shop", documentCount: 1 }],
      });
    }),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("fetchPickerItems", () => {
  it("asks the list of the connection's kind and narrows it with q", async () => {
    await fetchPickerItems("paperless", "tags", "rec");
    expect(requests).toEqual(["/api/v1/integrations/paperless/tags?q=rec"]);
  });

  it("leaves q out without a search text", async () => {
    await fetchPickerItems("paperless", "groups");
    expect(requests).toEqual(["/api/v1/integrations/paperless/groups"]);
  });

  it("gives every list the same shape", async () => {
    const tags = await fetchPickerItems("paperless", "tags");
    expect(tags.map((t) => t.name)).toEqual(["Apartment", "Receipt"]);
    expect(tags[0]?.detail).toBe("3 Dokumente");
    expect(tags[1]?.detail).toBeNull();

    const fields = await fetchPickerItems("paperless", "custom-fields");
    expect(fields.map((f) => f.dataType)).toEqual(["date", "monetary"]);

    const paths = await fetchPickerItems("paperless", "storage-paths");
    expect(paths[0]?.detail).toBe("apartment/{title}");

    const groups = await fetchPickerItems("paperless", "groups");
    expect(groups[0]).toMatchObject({ id: 50, detail: null, dataType: null });

    const correspondents = await fetchPickerItems(
      "paperless",
      "correspondents",
    );
    expect(correspondents[0]?.detail).toBe("1 Dokument");
  });
});

describe("loadAllPickerItems", () => {
  it("shares one request between the pickers of a form", async () => {
    await Promise.all([
      loadAllPickerItems("paperless", "tags"),
      loadAllPickerItems("paperless", "tags"),
      loadAllPickerItems("paperless", "tags"),
    ]);
    await loadAllPickerItems("paperless", "tags");
    expect(requests).toHaveLength(1);
    await loadAllPickerItems("paperless", "groups");
    expect(requests).toHaveLength(2);
  });

  it("asks again after the connection changed", async () => {
    await loadAllPickerItems("paperless", "tags");
    forgetPickerItems();
    await loadAllPickerItems("paperless", "tags");
    expect(requests).toHaveLength(2);
  });

  it("does not remember a failure", async () => {
    failNext = true;
    await expect(loadAllPickerItems("paperless", "tags")).rejects.toThrow();
    await Promise.resolve();
    const tags = await loadAllPickerItems("paperless", "tags");
    expect(tags).toHaveLength(2);
    expect(requests).toHaveLength(2);
  });
});
