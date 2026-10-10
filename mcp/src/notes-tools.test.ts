import { describe, expect, it } from "vitest";
import { useMcp } from "./test-harness";

describe("asset note tools", () => {
  const mcp = useMcp();

  it("notes an issue on an asset by name, lists it and resolves it", async () => {
    const { ok, anna } = await mcp.connect();
    await ok("create_asset", { name: "Kombi" });
    const added = await ok("add_asset_note", {
      asset: "kombi",
      text: "Bremsen quietschen",
    });
    expect(added).toMatchObject({
      asset: "Kombi",
      text: "Bremsen quietschen",
      status: "open",
      addedBy: "Anna",
    });
    await ok("add_asset_note", { asset: "Kombi", text: "Licht flackert" });

    const open = await ok("list_asset_notes", { asset: "Kombi" });
    expect(open.notes.map((n: { text: string }) => n.text)).toEqual([
      "Licht flackert",
      "Bremsen quietschen",
    ]);

    const resolved = await ok("resolve_asset_note", { id: added.id });
    expect(resolved).toMatchObject({
      status: "resolved",
      resolvedBy: "Anna",
      resolvedAt: expect.any(String),
    });
    expect(anna.id).toBeTruthy();
    expect(
      (await ok("list_asset_notes", { asset: "Kombi" })).notes.map(
        (n: { text: string }) => n.text,
      ),
    ).toEqual(["Licht flackert"]);
    expect(
      (await ok("list_asset_notes", { asset: "Kombi", status: "resolved" }))
        .notes,
    ).toMatchObject([{ id: added.id, status: "resolved" }]);
    expect(
      (await ok("list_asset_notes", { asset: "Kombi", status: "all" })).notes,
    ).toHaveLength(2);
  });

  it("resolving twice changes nothing", async () => {
    const { ok } = await mcp.connect();
    await ok("create_asset", { name: "Kombi" });
    const note = await ok("add_asset_note", { asset: "Kombi", text: "Test" });
    const first = await ok("resolve_asset_note", { id: note.id });
    const second = await ok("resolve_asset_note", { id: note.id });
    expect(second.resolvedAt).toBe(first.resolvedAt);
  });

  it("names the asset in an error when it is unknown or ambiguous, and the note when it is unknown", async () => {
    const { ok, call } = await mcp.connect();
    await ok("create_asset", { name: "Kombi Rot" });
    await ok("create_asset", { name: "Kombi Blau" });
    const unknown = await call("add_asset_note", { asset: "Nope", text: "x" });
    expect(unknown.isError).toBe(true);
    expect(unknown.text).toContain("[not_found]");
    const ambiguous = await call("add_asset_note", {
      asset: "Kombi",
      text: "x",
    });
    expect(ambiguous.isError).toBe(true);
    expect(ambiguous.text).toContain("ambiguous");
    expect((await call("resolve_asset_note", { id: "nope" })).text).toContain(
      "[not_found]",
    );
    expect(
      (await call("add_asset_note", { asset: "Kombi Rot", text: "" })).isError,
    ).toBe(true);
  });

  it("shows the open notes of a task's asset in the task lists", async () => {
    const { ok, day } = await mcp.connect();
    await ok("create_asset", { name: "Kombi" });
    await ok("create_task", {
      title: "Service",
      asset: "Kombi",
      trigger: { type: "one_off", date: day(0) },
    });
    await ok("create_task", {
      title: "Frei",
      trigger: { type: "one_off", date: day(0) },
    });
    await ok("add_asset_note", { asset: "Kombi", text: "Eins" });
    await ok("add_asset_note", { asset: "Kombi", text: "Zwei" });
    const tasks = await ok("list_tasks");
    const byTitle = Object.fromEntries(
      tasks.tasks.map((t: { title: string; openNotes?: number }) => [
        t.title,
        t.openNotes,
      ]),
    );
    expect(byTitle).toEqual({ Service: 2, Frei: undefined });
    const upcoming = await ok("list_upcoming", { horizon: "today" });
    const entries = [...(upcoming.overdue ?? []), ...upcoming.today];
    expect(
      entries.find((t: { title: string }) => t.title === "Service").openNotes,
    ).toBe(2);
  });

  it("logs the work and the notes it addressed with add_service_log", async () => {
    const { ok } = await mcp.connect();
    await ok("create_asset", { name: "Kombi" });
    const [one, two] = [
      await ok("add_asset_note", { asset: "Kombi", text: "Eins" }),
      await ok("add_asset_note", { asset: "Kombi", text: "Zwei" }),
    ];
    const entry = await ok("add_service_log", {
      asset: "Kombi",
      title: "Bremsen gemacht",
      resolvedNoteIds: [one.id],
    });
    expect(entry.title).toBe("Bremsen gemacht");
    const resolved = await ok("list_asset_notes", {
      asset: "Kombi",
      status: "resolved",
    });
    expect(resolved.notes).toMatchObject([
      { id: one.id, serviceLogId: entry.id },
    ]);
    expect(
      (await ok("list_asset_notes", { asset: "Kombi" })).notes.map(
        (n: { id: string }) => n.id,
      ),
    ).toEqual([two.id]);
  });

  it("offers reading to a read-only token and writing only with the write scope", async () => {
    const { client } = await mcp.connect({ scopes: ["read"] });
    const names = (await client.listTools()).tools.map((t) => t.name);
    expect(names).toContain("list_asset_notes");
    expect(names).not.toContain("add_asset_note");
    expect(names).not.toContain("resolve_asset_note");
  });
});
