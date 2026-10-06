import { afterEach, describe, expect, it } from "vitest";
import { createApiClient } from "../../src/lib/api/client";
import { endpoints } from "../../src/lib/api/registry";
import { shutdownMarkdownWorkers } from "../../src/lib/server/docs/markdown-runner";
import { plainPng } from "../../src/lib/server/files/test-images";
import { createInProcessFetch } from "../../src/lib/testing/api";
import { useTestFilesDir } from "../../src/lib/testing/files";
import { useMcp } from "./test-harness";

afterEach(() => shutdownMarkdownWorkers());

const ALL = ["read", "write", "docs:write"] as const;

/** A client for setting up records that have no MCP tool (contacts, parts, photos). */
const setup = (token: string) =>
  createApiClient(createInProcessFetch({ bearer: token }), "http://localhost", {
    token,
  });

describe("documentation pages", () => {
  const mcp = useMcp();
  useTestFilesDir();

  it("creates, lists, reads and searches a page", async () => {
    const { ok } = await mcp.connect({ scopes: [...ALL] });
    await ok("create_asset", { name: "Dishwasher" });
    const created = await ok("create_page", {
      title: "Dishwasher manual",
      section: "device",
      asset: "dishwasher",
      bodyMd: "# Salt\n\nRefill the **regeneration salt** monthly.",
      pinned: true,
    });
    expect(created).toMatchObject({
      slug: "dishwasher-manual",
      title: "Dishwasher manual",
      section: "device",
      rev: 1,
      pinned: true,
    });

    const list = await ok("list_pages", { q: "salt" });
    expect(list.pages.map((p: { slug: string }) => p.slug)).toEqual([
      "dishwasher-manual",
    ]);
    expect((await ok("list_pages", { section: "rules" })).pages).toEqual([]);
    expect(
      (await ok("list_pages", { asset: "Dishwasher" })).pages,
    ).toHaveLength(1);

    const page = await ok("get_page", { slug: "dishwasher-manual" });
    expect(page).toMatchObject({
      id: created.id,
      rev: 1,
      bodyMd: "# Salt\n\nRefill the **regeneration salt** monthly.",
      headings: ["# Salt"],
    });

    const hits = await ok("search", { q: "regeneration" });
    expect(hits.hits).toMatchObject([
      {
        type: "page",
        slug: "dishwasher-manual",
        url: "/docs/dishwasher-manual",
      },
    ]);
  });

  it("updates with the rev and reports a conflict with the current rev", async () => {
    const { ok, call } = await mcp.connect({ scopes: [...ALL] });
    await ok("create_page", { title: "Rules", bodyMd: "Quiet hours" });
    const updated = await ok("update_page", {
      slug: "rules",
      rev: 1,
      bodyMd: "Quiet hours 22:00-07:00",
      section: "rules",
    });
    expect(updated).toMatchObject({ rev: 2, section: "rules" });
    expect((await ok("get_page", { slug: "rules" })).bodyMd).toBe(
      "Quiet hours 22:00-07:00",
    );

    const stale = await call("update_page", {
      slug: "rules",
      rev: 1,
      bodyMd: "overwritten",
    });
    expect(stale.isError).toBe(true);
    expect(stale.text).toContain("[conflict]");
    expect(stale.text).toContain("now rev 2");
    expect((await ok("get_page", { slug: "rules" })).bodyMd).toBe(
      "Quiet hours 22:00-07:00",
    );

    const empty = await call("update_page", { slug: "rules", rev: 2 });
    expect(empty.text).toContain("[invalid_request]");
    expect((await call("get_page", { slug: "nope" })).text).toContain(
      "[not_found]",
    );
  });

  it("archives a page and lists its attachments by name", async () => {
    const { ok, token } = await mcp.connect({ scopes: [...ALL] });
    const page = await ok("create_page", { title: "Manual" });
    const api = setup(token);
    await api.call(endpoints.attachmentsUpload, {
      body: {
        file: new File([plainPng() as BlobPart], "front.png", {
          type: "image/png",
        }),
        ownerType: "page",
        ownerId: page.id,
        caption: "Front",
      },
    });
    const read = await ok("get_page", { slug: "manual" });
    expect(read.attachments).toMatchObject([
      { filename: "front.png", mime: "image/png", caption: "Front" },
    ]);
    await ok("update_page", { slug: "manual", rev: 1, archived: true });
    expect((await ok("list_pages")).pages).toEqual([]);
    expect(
      (await ok("list_pages", { includeArchived: true })).pages[0].archived,
    ).toBe(true);
  });

  it("only offers the page writers to a token with docs:write", async () => {
    const without = await mcp.connect({ scopes: ["read", "write"] });
    expect(without.server.tools).toContain("get_page");
    expect(without.server.tools).not.toContain("create_page");
    expect(without.server.tools).not.toContain("update_page");
    const withScope = await mcp.connect({ scopes: ["read", "docs:write"] });
    expect(withScope.server.tools).toContain("update_page");
    expect(withScope.server.tools).not.toContain("create_asset");
  });
});

describe("defects", () => {
  const mcp = useMcp();
  useTestFilesDir();

  it("reports, lists, changes the status and reads the timeline", async () => {
    const { ok, call, today, day } = await mcp.connect({ scopes: [...ALL] });
    await ok("create_asset", { name: "Window" });
    const defect = await ok("create_defect", {
      title: "Crack in the glass",
      descriptionMd: "About 30 cm",
      severity: "high",
      asset: "Window",
      locationDetail: "living room, left",
      deadlineDate: day(60),
    });
    expect(defect).toMatchObject({
      number: 1,
      title: "Crack in the glass",
      status: "open",
      severity: "high",
      asset: "Window",
      deadline: day(60),
      discoveredOn: today,
    });

    const active = await ok("list_defects");
    expect(active.defects).toHaveLength(1);

    const moved = await ok("set_defect_status", {
      id: defect.id,
      status: "reported",
      note: "Sent to the property manager",
    });
    expect(moved.status).toBe("reported");
    expect(moved.reportedOn).toBe(today);

    await ok("add_comment", {
      entityType: "defect",
      entityId: defect.id,
      bodyMd: "They promised a visit",
    });
    const detail = await ok("get_defect", { id: defect.id });
    expect(detail).toMatchObject({
      description: "About 30 cm",
      status: "reported",
      location: "living room, left",
    });
    expect(detail.timeline.map((t: { type: string }) => t.type)).toEqual([
      "created",
      "status",
      "comment",
    ]);
    expect(detail.timeline[1]).toMatchObject({
      from: "open",
      to: "reported",
      text: "Sent to the property manager",
    });
    expect(detail.timeline[2]).toMatchObject({
      by: "Anna",
      text: "They promised a visit",
    });

    await ok("set_defect_status", { id: defect.id, status: "fixed" });
    expect((await ok("list_defects")).defects).toEqual([]);
    expect(
      (await ok("list_defects", { status: "fixed" })).defects,
    ).toHaveLength(1);
    expect((await ok("list_defects", { status: "all" })).defects).toHaveLength(
      1,
    );
    const invalid = await call("set_defect_status", {
      id: defect.id,
      status: "reported",
    });
    expect(invalid.isError).toBe(true);
  });

  it("filters by text, severity and room, and pages", async () => {
    const { ok } = await mcp.connect({ scopes: [...ALL] });
    await ok("create_defect", { title: "Loose tile", severity: "low" });
    await ok("create_defect", { title: "Leaking tap", severity: "high" });
    await ok("create_defect", { title: "Scratch on door" });
    expect((await ok("list_defects", { q: "tile" })).defects).toHaveLength(1);
    expect(
      (await ok("list_defects", { severity: "high" })).defects[0].title,
    ).toBe("Leaking tap");
    const first = await ok("list_defects", { limit: 2 });
    expect(first.defects).toHaveLength(2);
    expect(first.nextCursor).toBeTruthy();
    expect(
      (await ok("list_defects", { limit: 2, cursor: first.nextCursor }))
        .defects,
    ).toHaveLength(1);
  });

  it("names the contact responsible and lists attached photos by name", async () => {
    const { ok, call, token } = await mcp.connect({ scopes: [...ALL] });
    const api = setup(token);
    await api.call(endpoints.contactsCreate, {
      body: { name: "Muster Property Management", kind: "property_mgmt" },
    });
    const defect = await ok("create_defect", {
      title: "Door sticks",
      responsibleContact: "Muster Property Management",
    });
    expect(defect.responsible).toBe("Muster Property Management");
    await api.call(endpoints.attachmentsUpload, {
      body: {
        file: new File([plainPng() as BlobPart], "door.png", {
          type: "image/png",
        }),
        ownerType: "defect",
        ownerId: defect.id,
      },
    });
    const detail = await ok("get_defect", { id: defect.id });
    expect(detail.attachments).toMatchObject([{ filename: "door.png" }]);

    const unknown = await call("create_defect", {
      title: "x",
      responsibleContact: "Nobody Ltd",
    });
    expect(unknown.text).toContain("[not_found]");
  });
});

describe("parts and stock", () => {
  const mcp = useMcp();

  it("lists parts and books stock movements", async () => {
    const { ok, call, token } = await mcp.connect({ scopes: [...ALL] });
    const api = setup(token);
    await api.call(endpoints.partsCreate, {
      body: {
        name: "Water filter",
        partNumber: "WF-100",
        supplier: "Example Parts",
        stockCount: 3,
        minStock: 2,
      },
    });
    await api.call(endpoints.partsCreate, {
      body: { name: "Gasket", stockCount: 10 },
    });

    expect((await ok("list_parts")).parts).toHaveLength(2);
    expect((await ok("list_parts", { q: "WF-100" })).parts[0]).toMatchObject({
      name: "Water filter",
      stock: 3,
      supplier: "Example Parts",
    });

    const used = await ok("adjust_stock", { part: "water filter", delta: -2 });
    expect(used).toMatchObject({ stock: 1, lowStock: true });
    const low = await ok("list_parts", { lowStock: true });
    expect(low.parts.map((p: { name: string }) => p.name)).toEqual([
      "Water filter",
    ]);

    const bought = await ok("adjust_stock", {
      part: "WF-100",
      delta: 4,
      note: "bought a pack",
    });
    expect(bought.stock).toBe(5);
    const moves = await api.call(endpoints.partsMovements, {
      params: { id: bought.id },
    });
    expect(moves.items.map((m) => [m.delta, m.reason, m.note]).sort()).toEqual(
      [
        [3, "correction", null],
        [-2, "used", null],
        [4, "bought", "bought a pack"],
      ].sort(),
    );

    const correction = await ok("adjust_stock", {
      part: "Gasket",
      delta: -3,
      reason: "correction",
    });
    expect(correction.stock).toBe(7);

    const wrong = await call("adjust_stock", {
      part: "Gasket",
      delta: 5,
      reason: "used",
    });
    expect(wrong.isError).toBe(true);
    expect(
      (await call("adjust_stock", { part: "Gasket", delta: 0 })).text,
    ).toContain("[invalid_request]");
    expect(
      (await call("adjust_stock", { part: "Unknown", delta: 1 })).text,
    ).toContain("[not_found]");
  });

  it("shows the shopping list and reports an ambiguous name", async () => {
    const { ok, call, token, day } = await mcp.connect({ scopes: [...ALL] });
    const api = setup(token);
    const part = await api.call(endpoints.partsCreate, {
      body: { name: "Filter cartridge", stockCount: 0, leadTimeDays: 14 },
    });
    await api.call(endpoints.partsCreate, {
      body: { name: "Filter cartridge XL" },
    });
    const task = await ok("create_task", {
      title: "Replace cartridge",
      trigger: { type: "one_off", date: day(10) },
    });
    await api.call(endpoints.taskPartsLink, {
      params: { id: task.id },
      body: { partId: part.id, qty: 2 },
    });
    const shopping = await ok("list_parts", { orderNow: true });
    expect(shopping.orderNow).toMatchObject([
      { part: "Filter cartridge", task: "Replace cartridge", quantity: 2 },
    ]);
    const upcoming = await ok("list_upcoming");
    expect(upcoming.orderNow).toMatchObject([{ part: "Filter cartridge" }]);

    const ambiguous = await call("adjust_stock", {
      part: "cartridge",
      delta: 1,
    });
    expect(ambiguous.text).toContain("[invalid_request]");
    expect(ambiguous.text).toContain("Candidates");
  });
});

describe("contacts", () => {
  const mcp = useMcp();

  it("lists, filters and reads contacts by name", async () => {
    const { ok, call, token } = await mcp.connect({ scopes: [...ALL] });
    const api = setup(token);
    await api.call(endpoints.contactsCreate, {
      body: {
        name: "Muster Plumbing",
        company: "Muster AG",
        kind: "installer",
        phone: "+41 00 000 00 00",
        email: "info@muster.example.org",
        notes: "Ask for Max",
      },
    });
    await api.call(endpoints.contactsCreate, {
      body: { name: "Water utility", kind: "emergency", emergency: true },
    });

    expect((await ok("list_contacts")).contacts).toHaveLength(2);
    expect(
      (await ok("list_contacts", { emergency: true })).contacts.map(
        (c: { name: string }) => c.name,
      ),
    ).toEqual(["Water utility"]);
    expect(
      (await ok("list_contacts", { kind: "installer" })).contacts[0].phone,
    ).toBe("+41 00 000 00 00");
    expect((await ok("list_contacts", { q: "muster" })).contacts).toHaveLength(
      1,
    );

    const contact = await ok("get_contact", { contact: "Muster Plumbing" });
    expect(contact).toMatchObject({
      name: "Muster Plumbing",
      company: "Muster AG",
      email: "info@muster.example.org",
      notes: "Ask for Max",
    });
    expect((await ok("get_contact", { contact: "Muster AG" })).name).toBe(
      "Muster Plumbing",
    );
    expect((await call("get_contact", { contact: "Nobody" })).text).toContain(
      "[not_found]",
    );
  });
});

describe("comments", () => {
  const mcp = useMcp();

  it("comments on a task and a page and lists the thread", async () => {
    const { ok, call, day } = await mcp.connect({ scopes: [...ALL] });
    const task = await ok("create_task", {
      title: "Bins",
      trigger: { type: "one_off", date: day(1) },
    });
    await ok("add_comment", {
      entityType: "task",
      entityId: task.id,
      bodyMd: "First **note**",
    });
    await ok("add_comment", {
      entityType: "task",
      entityId: task.id,
      bodyMd: "Second",
    });
    const thread = await ok("list_comments", {
      entityType: "task",
      entityId: task.id,
    });
    expect(thread.comments).toMatchObject([
      { by: "Anna", text: "First **note**" },
      { text: "Second" },
    ]);

    const page = await ok("create_page", { title: "House rules" });
    await ok("add_comment", {
      entityType: "doc_page",
      entityId: page.id,
      bodyMd: "Please update the quiet hours",
    });
    expect((await ok("get_page", { slug: "house-rules" })).commentCount).toBe(
      1,
    );

    const missing = await call("add_comment", {
      entityType: "defect",
      entityId: "nope",
      bodyMd: "x",
    });
    expect(missing.text).toContain("[not_found]");
    expect(
      (
        await call("add_comment", {
          entityType: "task",
          entityId: task.id,
          bodyMd: "   ",
        })
      ).isError,
    ).toBe(true);
  });
});

describe("hints, service log and warranties", () => {
  const mcp = useMcp();

  it("lists hints of an asset", async () => {
    const { ok, token } = await mcp.connect({ scopes: [...ALL] });
    const asset = await ok("create_asset", { name: "Dishwasher" });
    await ok("create_asset", { name: "Oven" });
    const api = setup(token);
    await api.call(endpoints.assetHintsCreate, {
      params: { id: asset.id },
      body: {
        title: "Run hot monthly",
        bodyMd: "Empty, 75 degrees",
        kind: "tip",
        pinned: true,
      },
    });
    await api.call(endpoints.assetHintsCreate, {
      params: { id: asset.id },
      body: { title: "No bleach", kind: "warning" },
    });
    const all = await ok("list_hints", { asset: "dishwasher" });
    expect(all.hints).toHaveLength(2);
    expect(all.hints[0]).toMatchObject({
      title: "Run hot monthly",
      asset: "Dishwasher",
      pinned: true,
    });
    expect(
      (await ok("list_hints", { kind: "warning" })).hints.map(
        (h: { title: string }) => h.title,
      ),
    ).toEqual(["No bleach"]);
    expect((await ok("list_hints", { asset: "Oven" })).hints).toEqual([]);
  });

  it("logs service work with a contact and a cost", async () => {
    const { ok, call, token, today } = await mcp.connect({
      scopes: [...ALL],
    });
    await ok("create_asset", { name: "Boiler" });
    const api = setup(token);
    await api.call(endpoints.contactsCreate, {
      body: { name: "Muster Heating", kind: "installer" },
    });
    const entry = await ok("add_service_log", {
      asset: "Boiler",
      title: "Descaled",
      kind: "maintenance",
      contact: "Muster Heating",
      costMinor: 12900,
      descriptionMd: "Annual service",
    });
    expect(entry).toMatchObject({
      asset: "Boiler",
      date: today,
      kind: "maintenance",
      title: "Descaled",
      contact: "Muster Heating",
      costMinor: 12900,
    });
    const asset = await ok("get_asset", { asset: "Boiler" });
    const log = await api.call(endpoints.assetServiceLogList, {
      params: { id: asset.id },
    });
    expect(log.items).toHaveLength(1);

    expect(
      (await call("add_service_log", { asset: "Nothing", title: "x" })).text,
    ).toContain("[not_found]");
  });

  it("lists warranties soonest first and filters by status", async () => {
    const { ok, day } = await mcp.connect({ scopes: [...ALL] });
    await ok("create_asset", { name: "Old TV", warrantyUntil: day(-10) });
    await ok("create_asset", { name: "Fridge", warrantyUntil: day(400) });
    await ok("create_asset", {
      name: "Washer",
      warrantyUntil: day(20),
      warrantyExtendedUntil: day(40),
    });
    await ok("create_asset", { name: "Lamp" });
    const all = await ok("list_warranties");
    expect(all.warranties.map((w: { asset: string }) => w.asset)).toEqual([
      "Old TV",
      "Washer",
      "Fridge",
    ]);
    expect(all.warranties[1]).toMatchObject({
      status: "expiring",
      effectiveUntil: day(40),
      daysLeft: 40,
    });
    expect(
      (await ok("list_warranties", { status: "expired" })).warranties,
    ).toHaveLength(1);
    const upcoming = await ok("list_upcoming");
    expect(
      upcoming.expiringWarranties.map((w: { asset: string }) => w.asset),
    ).toContain("Washer");
  });
});
