import { describe, expect, it } from "vitest";
import { createCaller, errorCode } from "$lib/testing/api";
import {
  createTestToken,
  createTestUser,
  loginTestUser,
} from "$lib/testing/auth";
import { useTestDB } from "$lib/testing/db";
import { today } from "$lib/testing/dates";
import { pdfInfo } from "$lib/testing/pdf";

type Defect = {
  id: string;
  number: number;
  status: string;
  deadlineDate: string | null;
  deadlineSource: string;
  reminderTaskId: string | null;
  reportedOn: string | null;
  fixedOn: string | null;
  commentCount: number;
  title: string;
};
type Detail = Defect & {
  events: {
    type: string;
    fromStatus: string | null;
    toStatus: string | null;
    bodyMd: string;
    userName: string | null;
  }[];
};
type Timeline = {
  items: { kind: string; type?: string; bodyMd: string; deleted?: boolean }[];
};

describe("defects API", () => {
  useTestDB();
  async function setup(locale: "de" | "en" = "de") {
    const user = await createTestUser({ displayName: "Anna", locale });
    const call = createCaller({ session: loginTestUser(user).token });
    const defect = async (json: object = {}) =>
      (
        await call("POST", "/api/v1/defects", {
          json: { title: "Riss in der Wand", ...json },
        })
      ).body as Defect;
    return { user, call, defect };
  }

  it("records, reads, updates and deletes a defect", async () => {
    const { call } = await setup();
    const room = (
      await call("POST", "/api/v1/rooms", { json: { name: "Bad" } })
    ).body as { id: string };
    const created = await call("POST", "/api/v1/defects", {
      json: {
        title: "Riss in der Wand",
        descriptionMd: "ca. 30 cm",
        severity: "high",
        roomId: room.id,
        locationDetail: "links oben",
        deadlineDate: today(100),
      },
    });
    expect(created.res.status).toBe(201);
    const d = created.body as Defect;
    expect(d).toMatchObject({
      number: 1,
      status: "open",
      discoveredOn: today(),
      deadlineDate: today(100),
      deadlineSource: "manual",
      roomName: "Bad",
    });
    expect(d.reminderTaskId).toEqual(expect.any(String));
    const detail = (await call("GET", `/api/v1/defects/${d.id}`))
      .body as Detail;
    expect(detail.events.map((e) => [e.type, e.toStatus, e.userName])).toEqual([
      ["created", "open", "Anna"],
    ]);
    const patched = await call("PATCH", `/api/v1/defects/${d.id}`, {
      json: { title: "Neu", reportedOn: today(-1), locationDetail: null },
    });
    expect(patched.body).toMatchObject({
      title: "Neu",
      reportedOn: today(-1),
      locationDetail: null,
    });
    expect((await call("DELETE", `/api/v1/defects/${d.id}`)).res.status).toBe(
      204,
    );
    expect(errorCode(await call("GET", `/api/v1/defects/${d.id}`))).toBe(
      "not_found",
    );
    expect(
      (
        (await call("GET", `/api/v1/tasks?externalSource=defect`)).body as {
          items: unknown[];
        }
      ).items,
    ).toEqual([]);
  });

  it("validates input and answers 404", async () => {
    const { call, defect } = await setup();
    for (const json of [
      {},
      { title: "" },
      { title: "x", severity: "extreme" },
      { title: "x", discoveredOn: "gestern" },
      { title: "x", roomId: "nope" },
      { title: "x", assetId: "nope" },
      { title: "x", responsibleContactId: "nope" },
      { title: "x", status: "fixed" },
    ]) {
      const r = await call("POST", "/api/v1/defects", { json });
      expect([r.res.status, errorCode(r)], JSON.stringify(json)).toEqual([
        400,
        "invalid_request",
      ]);
    }
    const d = await defect();
    for (const json of [
      {},
      { status: "fixed" },
      { deadlineDate: today(), deadlineSource: "handover" },
      { deadlineSource: "manual" },
    ]) {
      expect(
        errorCode(await call("PATCH", `/api/v1/defects/${d.id}`, { json })),
        JSON.stringify(json),
      ).toBe("invalid_request");
    }
    expect(
      errorCode(
        await call("PATCH", "/api/v1/defects/nope", { json: { title: "x" } }),
      ),
    ).toBe("not_found");
    expect(errorCode(await call("DELETE", "/api/v1/defects/nope"))).toBe(
      "not_found",
    );
    expect(
      errorCode(
        await call("POST", "/api/v1/defects/nope/status", {
          json: { status: "fixed" },
        }),
      ),
    ).toBe("not_found");
    expect(
      errorCode(
        await call("POST", "/api/v1/defects/nope/events", {
          json: { type: "correspondence", bodyMd: "x" },
        }),
      ),
    ).toBe("not_found");
    expect(errorCode(await call("GET", "/api/v1/defects/nope/timeline"))).toBe(
      "not_found",
    );
  });

  it("derives the deadline from the household's handover date", async () => {
    const { call, defect } = await setup();
    await createCaller({
      session: loginTestUser(await createTestUser({ role: "admin" })).token,
    })("PATCH", "/api/v1/household", { json: { handoverDate: "2026-04-03" } });
    const d = await defect();
    expect(d).toMatchObject({
      deadlineDate: "2028-04-03",
      deadlineSource: "handover",
    });
    expect((await defect({ deadlineDate: null })).deadlineDate).toBeNull();
    const reset = await call("PATCH", `/api/v1/defects/${d.id}`, {
      json: { deadlineDate: "2027-01-01" },
    });
    expect(reset.body).toMatchObject({ deadlineSource: "manual" });
    expect(
      (
        await call("PATCH", `/api/v1/defects/${d.id}`, {
          json: { deadlineSource: "handover" },
        })
      ).body,
    ).toMatchObject({ deadlineDate: "2028-04-03", deadlineSource: "handover" });
  });

  it("recomputes handover-based deadlines when the household changes", async () => {
    const { defect } = await setup();
    const admin = createCaller({
      session: loginTestUser(await createTestUser({ role: "admin" })).token,
    });
    await admin("PATCH", "/api/v1/household", {
      json: { handoverDate: "2026-04-03" },
    });
    const d = await defect();
    const manual = await defect({ deadlineDate: "2030-01-01" });
    await admin("PATCH", "/api/v1/household", {
      json: { settings: { defectDeadlineMonths: 12 } },
    });
    expect(
      ((await admin("GET", `/api/v1/defects/${d.id}`)).body as Defect)
        .deadlineDate,
    ).toBe("2027-04-03");
    expect(
      ((await admin("GET", `/api/v1/defects/${manual.id}`)).body as Defect)
        .deadlineDate,
    ).toBe("2030-01-01");
    expect(
      (
        (await admin("GET", "/api/v1/household")).body as {
          settings: { defectDeadlineMonths: number };
        }
      ).settings.defectDeadlineMonths,
    ).toBe(12);
    expect(
      errorCode(
        await admin("PATCH", "/api/v1/household", {
          json: { settings: { defectDeadlineMonths: 0 } },
        }),
      ),
    ).toBe("invalid_request");
  });

  it("changes the status along the allowed transitions and writes events", async () => {
    const { call, defect } = await setup();
    const d = await defect({ deadlineDate: today(60) });
    const reported = await call("POST", `/api/v1/defects/${d.id}/status`, {
      json: { status: "reported", note: "per Einschreiben" },
    });
    expect(reported.res.status).toBe(200);
    expect(reported.body).toMatchObject({
      status: "reported",
      reportedOn: today(),
    });
    await call("POST", `/api/v1/defects/${d.id}/status`, {
      json: { status: "in_progress" },
    });
    const fixed = (
      await call("POST", `/api/v1/defects/${d.id}/status`, {
        json: { status: "fixed", note: "erledigt" },
      })
    ).body as Detail;
    expect(fixed).toMatchObject({
      status: "fixed",
      fixedOn: today(),
      reminderTaskId: null,
    });
    expect(
      fixed.events.map((e) => [e.type, e.fromStatus, e.toStatus, e.bodyMd]),
    ).toEqual([
      ["created", null, "open", ""],
      ["status", "open", "reported", "per Einschreiben"],
      ["status", "reported", "in_progress", ""],
      ["status", "in_progress", "fixed", "erledigt"],
    ]);
    const bad = await call("POST", `/api/v1/defects/${d.id}/status`, {
      json: { status: "rejected" },
    });
    expect([bad.res.status, errorCode(bad)]).toEqual([409, "conflict"]);
    expect(
      errorCode(
        await call("POST", `/api/v1/defects/${d.id}/status`, {
          json: { status: "fixed" },
        }),
      ),
    ).toBe("conflict");
    expect(
      errorCode(
        await call("POST", `/api/v1/defects/${d.id}/status`, {
          json: { status: "done" },
        }),
      ),
    ).toBe("invalid_request");
    const reopened = (
      await call("POST", `/api/v1/defects/${d.id}/status`, {
        json: { status: "open" },
      })
    ).body as Detail;
    expect(reopened).toMatchObject({ status: "open", fixedOn: null });
    expect(reopened.reminderTaskId).toBe(d.reminderTaskId);
  });

  it("keeps a reminder task in step with the deadline and status", async () => {
    const { call, defect } = await setup();
    const d = await defect({
      deadlineDate: today(20),
      title: "Fenster klemmt",
    });
    const task = (await call("GET", `/api/v1/tasks/${d.reminderTaskId}`))
      .body as {
      title: string;
      category: string;
      source: string;
      externalSource: string;
      externalRef: string;
      state: { dueDate: string };
      preparations: { title: string; leadDays: number }[];
    };
    expect(task).toMatchObject({
      title: "Mangelfrist 1: Fenster klemmt",
      category: "defect",
      source: "system",
      externalSource: "defect",
      externalRef: d.id,
    });
    expect(task.state.dueDate).toBe(today(20));
    expect(task.preparations).toMatchObject([
      { title: "Mangel melden", leadDays: 30 },
    ]);
    await call("PATCH", `/api/v1/defects/${d.id}`, {
      json: { deadlineDate: today(40) },
    });
    expect(
      (
        (await call("GET", `/api/v1/tasks/${d.reminderTaskId}`)).body as {
          state: { dueDate: string };
        }
      ).state.dueDate,
    ).toBe(today(40));
    await call("POST", `/api/v1/defects/${d.id}/status`, {
      json: { status: "rejected" },
    });
    expect(
      (
        (await call("GET", `/api/v1/tasks/${d.reminderTaskId}`)).body as {
          archivedAt: string | null;
        }
      ).archivedAt,
    ).not.toBeNull();
  });

  it("lists active defects by deadline and filters", async () => {
    const { call, defect } = await setup();
    const room = (
      await call("POST", "/api/v1/rooms", { json: { name: "Bad" } })
    ).body as { id: string };
    await defect({ title: "ohne Frist" });
    await defect({ title: "spät", deadlineDate: today(300) });
    await defect({
      title: "bald",
      deadlineDate: today(30),
      severity: "high",
      roomId: room.id,
    });
    const closed = await defect({ title: "zu", deadlineDate: today(10) });
    await call("POST", `/api/v1/defects/${closed.id}/status`, {
      json: { status: "fixed" },
    });
    const titles = async (qs = "") =>
      (
        (await call("GET", `/api/v1/defects${qs}`)).body as { items: Defect[] }
      ).items.map((d) => d.title);
    expect(await titles()).toEqual(["bald", "spät", "ohne Frist", "zu"]);
    expect(await titles("?active=true")).toEqual([
      "bald",
      "spät",
      "ohne Frist",
    ]);
    expect(await titles("?status=fixed")).toEqual(["zu"]);
    expect(await titles("?severity=high")).toEqual(["bald"]);
    expect(await titles(`?roomId=${room.id}`)).toEqual(["bald"]);
    expect(await titles("?q=SPÄT")).toEqual(["spät"]);
    const page = (await call("GET", "/api/v1/defects?limit=3")).body as {
      items: Defect[];
      nextCursor: string;
    };
    const next = (
      await call("GET", `/api/v1/defects?limit=3&cursor=${page.nextCursor}`)
    ).body as { items: Defect[] };
    expect([page.items.length, next.items.length]).toEqual([3, 1]);
    expect(errorCode(await call("GET", "/api/v1/defects?status=nope"))).toBe(
      "invalid_request",
    );
  });

  it("fills the dashboard with open defects sorted by deadline", async () => {
    const { call, defect } = await setup();
    await defect({ title: "ohne" });
    await defect({ title: "spät", deadlineDate: today(300) });
    await defect({ title: "bald", deadlineDate: today(30), severity: "high" });
    const closed = await defect({ title: "zu" });
    await call("POST", `/api/v1/defects/${closed.id}/status`, {
      json: { status: "rejected" },
    });
    const d = (await call("GET", "/api/v1/dashboard")).body as {
      openDefects: {
        id: string;
        title: string;
        date: string | null;
        number: number;
        status: string;
        severity: string;
      }[];
    };
    expect(
      d.openDefects.map((x) => [x.title, x.date, x.status, x.severity]),
    ).toEqual([
      ["bald", today(30), "open", "high"],
      ["spät", today(300), "open", "medium"],
      ["ohne", null, "open", "medium"],
    ]);
  });

  it("notes correspondence and shows events and comments in one timeline", async () => {
    const { call, defect } = await setup();
    const d = await defect();
    const ev = await call("POST", `/api/v1/defects/${d.id}/events`, {
      json: {
        type: "correspondence",
        bodyMd: "Brief an die Verwaltung",
        externalRef: "doc-7",
      },
    });
    expect(ev.res.status).toBe(201);
    expect(ev.body).toMatchObject({
      type: "correspondence",
      externalRef: "doc-7",
      userName: "Anna",
    });
    const c = (
      await call("POST", "/api/v1/comments", {
        json: { entityType: "defect", entityId: d.id, bodyMd: "Foto folgt" },
      })
    ).body as { id: string };
    const gone = (
      await call("POST", "/api/v1/comments", {
        json: { entityType: "defect", entityId: d.id, bodyMd: "Tippfehler" },
      })
    ).body as { id: string };
    await call("DELETE", `/api/v1/comments/${gone.id}`);
    const { items } = (await call("GET", `/api/v1/defects/${d.id}/timeline`))
      .body as Timeline;
    expect(
      items.map((i) => [
        i.kind,
        i.kind === "event" ? i.type : i.bodyMd,
        i.deleted ?? false,
      ]),
    ).toEqual([
      ["event", "created", false],
      ["event", "correspondence", false],
      ["comment", "Foto folgt", false],
      ["comment", "", true],
    ]);
    expect(
      ((await call("GET", `/api/v1/defects/${d.id}`)).body as Defect)
        .commentCount,
    ).toBe(1);
    expect(c.id).toBeTruthy();
    expect(
      errorCode(
        await call("POST", `/api/v1/defects/${d.id}/events`, {
          json: { type: "status", bodyMd: "x" },
        }),
      ),
    ).toBe("invalid_request");
    expect(
      errorCode(
        await call("POST", `/api/v1/defects/${d.id}/events`, {
          json: { type: "correspondence", bodyMd: " " },
        }),
      ),
    ).toBe("invalid_request");
  });

  describe("pdf export", () => {
    it("returns an A4 pdf with a sensible size and at least one page", async () => {
      const { call, defect } = await setup();
      await defect({
        title: "Riss in der Wand",
        descriptionMd: "ca. 30 cm",
        deadlineDate: today(100),
      });
      await call(
        "POST",
        "/api/v1/defects/" +
          (await defect({ title: "Zweiter" })).id +
          "/status",
        { json: { status: "reported" } },
      );
      const r = await call("GET", "/api/v1/defects/export.pdf");
      expect(r.res.status).toBe(200);
      expect(r.res.headers.get("content-type")).toBe("application/pdf");
      expect(r.res.headers.get("content-disposition")).toBe(
        `attachment; filename="defects-${today()}.pdf"`,
      );
      expect(r.res.headers.get("cache-control")).toBe("no-store");
      const bytes = r.body as Uint8Array;
      const info = pdfInfo(bytes);
      expect(info.header).toBe("%PDF-");
      expect(info.trailer).toBe(true);
      expect(info.pageCount).toBeGreaterThanOrEqual(1);
      expect(bytes.length).toBeGreaterThan(5000);
    });

    it("is also a valid document without defects, filtered, in either language", async () => {
      const de = await setup("de");
      const empty = await de.call("GET", "/api/v1/defects/export.pdf");
      expect(pdfInfo(empty.body as Uint8Array).pageCount).toBe(1);
      await de.defect();
      const all = await de.call("GET", "/api/v1/defects/export.pdf");
      const none = await de.call(
        "GET",
        "/api/v1/defects/export.pdf?status=fixed",
      );
      expect((all.body as Uint8Array).length).toBeGreaterThan(
        (none.body as Uint8Array).length,
      );
      const en = createCaller({
        session: loginTestUser(await createTestUser({ locale: "en" })).token,
      });
      const english = await en("GET", "/api/v1/defects/export.pdf");
      expect(
        Buffer.from(english.body as Uint8Array).equals(
          Buffer.from(all.body as Uint8Array),
        ),
      ).toBe(false);
      expect(
        pdfInfo(english.body as Uint8Array).pageCount,
      ).toBeGreaterThanOrEqual(1);
    });

    it("validates the filters and works for tokens with the read scope", async () => {
      const { user } = await setup();
      const reader = createCaller({
        bearer: createTestToken(user, { scopes: ["read"] }).token,
      });
      expect(
        (await reader("GET", "/api/v1/defects/export.pdf")).res.status,
      ).toBe(200);
      expect(
        errorCode(
          await reader("GET", "/api/v1/defects/export.pdf?status=nope"),
        ),
      ).toBe("invalid_request");
      const noScope = createCaller({
        bearer: createTestToken(user, { scopes: ["write"] }).token,
      });
      expect(
        (await noScope("GET", "/api/v1/defects/export.pdf")).res.status,
      ).toBe(403);
    });
  });

  it("needs write scope to change", async () => {
    const { user, defect } = await setup();
    const d = await defect();
    const reader = createCaller({
      bearer: createTestToken(user, { scopes: ["read"] }).token,
    });
    expect((await reader("GET", `/api/v1/defects/${d.id}`)).res.status).toBe(
      200,
    );
    expect(
      (
        await reader("POST", `/api/v1/defects/${d.id}/status`, {
          json: { status: "fixed" },
        })
      ).res.status,
    ).toBe(403);
  });
});
