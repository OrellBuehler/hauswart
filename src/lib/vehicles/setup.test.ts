import { describe, expect, it, vi } from "vitest";
import {
  createPreparationRequestSchema,
  createTaskRequestSchema,
  type Task,
} from "$lib/api/schemas/tasks";
import { odometerSignalKey } from "./odometer";
import {
  DEFAULT_SELECTED,
  SETUP_TEMPLATE_IDS,
  buildTemplate,
  createTemplates,
  defaultParams,
  findExistingTask,
  templateTitles,
  type SetupContext,
  type SetupParams,
  type TemplateRun,
} from "./setup";
import { vehicleTemplates } from "./templates";

const ASSET = "6f1c2d3e-0000-4000-8000-000000000001";
const OTHER_ASSET = "6f1c2d3e-0000-4000-8000-000000000002";

const ctx = (over: Partial<SetupContext> = {}): SetupContext => ({
  assetId: ASSET,
  firstRegistration: "2022-03-10",
  today: "2026-10-10",
  odometerUnit: "km",
  ...over,
});

const params = (over: Partial<SetupParams> = {}): SetupParams => ({
  ...defaultParams(ctx()),
  ...over,
});

describe("defaultParams", () => {
  it("offers the service distance of the unit and a year", () => {
    expect(defaultParams(ctx()).serviceDistance).toBe("15000");
    expect(defaultParams(ctx({ odometerUnit: "mi" })).serviceDistance).toBe(
      "10000",
    );
    expect(defaultParams(ctx()).serviceMonths).toBe("12");
  });

  it("suggests the next inspection from the first registration: 4, 7, then every 2 years", () => {
    expect(defaultParams(ctx()).mfkDate).toBe("2029-03-10");
    expect(
      defaultParams(ctx({ firstRegistration: "2018-05-01" })).mfkDate,
    ).toBe("2027-05-01");
  });

  it("has no suggestion without a first registration", () => {
    expect(defaultParams(ctx({ firstRegistration: null })).mfkDate).toBe("");
  });

  it("starts the vehicle tax at the end of March and the two year jobs at today", () => {
    const p = defaultParams(ctx());
    expect([p.taxMonth, p.taxDay]).toEqual(["3", "31"]);
    expect([p.brakeFluidLastDone, p.acServiceLastDone]).toEqual(["", ""]);
  });
});

describe("what is checked at first", () => {
  it("are tires, service and inspection, and all of them are templates", () => {
    expect([...DEFAULT_SELECTED]).toEqual([
      "tires_winter",
      "tires_summer",
      "service",
      "mfk",
    ]);
    for (const id of DEFAULT_SELECTED) {
      expect(SETUP_TEMPLATE_IDS).toContain(id);
    }
  });
});

describe("buildTemplate", () => {
  it.each(SETUP_TEMPLATE_IDS)(
    "%s with the defaults is a valid task for the vehicle",
    (id) => {
      const { template, errors } = buildTemplate(id, ctx(), params());
      expect(errors).toEqual({});
      expect(template?.id).toBe(id);
      const parsed = createTaskRequestSchema.safeParse(template?.task);
      expect(parsed.error?.issues).toBeUndefined();
      expect(parsed.data?.assetId).toBe(ASSET);
      for (const preparation of template?.preparations ?? []) {
        expect(
          createPreparationRequestSchema.safeParse(preparation).success,
        ).toBe(true);
      }
    },
  );

  it("builds the service from the distance and the months, reading the vehicle's odometer", () => {
    const { template } = buildTemplate(
      "service",
      ctx(),
      params({ serviceDistance: "20'000", serviceMonths: "24" }),
    );
    expect(template?.task.trigger).toMatchObject({
      type: "counter_delta",
      entityId: odometerSignalKey(ASSET),
      threshold: 20000,
      unit: "km",
      orEvery: { every: 24, unit: "month" },
    });
  });

  it("builds the inspection on the date given", () => {
    const { template } = buildTemplate(
      "mfk",
      ctx(),
      params({ mfkDate: "2027-01-15" }),
    );
    expect(template?.task.trigger).toEqual({
      v: 1,
      type: "one_off",
      date: "2027-01-15",
    });
  });

  it("builds the vehicle tax on the month and day given, from the next time they come round", () => {
    const { template } = buildTemplate(
      "vehicle_tax",
      ctx(),
      params({ taxMonth: "6", taxDay: "30" }),
    );
    expect(template?.task.trigger).toMatchObject({
      type: "calendar",
      freq: "yearly",
      byMonth: [6],
      byMonthDay: 30,
      startDate: "2027-06-30",
    });
  });

  it("starts the two year jobs two years after the day they were last done", () => {
    const { template } = buildTemplate(
      "brake_fluid",
      ctx(),
      params({ brakeFluidLastDone: "2025-08-20" }),
    );
    expect(template?.task.trigger).toMatchObject({
      type: "interval",
      every: 2,
      unit: "year",
      startDate: "2027-08-20",
    });
    const fresh = buildTemplate("ac_service", ctx(), params());
    expect(fresh.template?.task.trigger).toMatchObject({
      startDate: "2028-10-10",
    });
  });

  it("titles the task in the language of the app", () => {
    const { template } = buildTemplate("tires_winter", ctx(), params());
    expect(template?.task.title).toBe("Winterreifen aufziehen");
  });

  it("reports each wrong parameter under its name and builds nothing", () => {
    const service = buildTemplate(
      "service",
      ctx(),
      params({ serviceDistance: "0", serviceMonths: "1.5" }),
    );
    expect(service.template).toBeUndefined();
    expect(Object.keys(service.errors).sort()).toEqual([
      "serviceDistance",
      "serviceMonths",
    ]);

    expect(
      buildTemplate("mfk", ctx(), params({ mfkDate: "" })).errors.mfkDate,
    ).toBeTruthy();
    expect(
      buildTemplate("mfk", ctx(), params({ mfkDate: "2027-02-30" })).errors
        .mfkDate,
    ).toBeTruthy();

    const tax = buildTemplate(
      "vehicle_tax",
      ctx(),
      params({ taxMonth: "13", taxDay: "0" }),
    );
    expect(Object.keys(tax.errors).sort()).toEqual(["taxDay", "taxMonth"]);

    expect(
      buildTemplate("brake_fluid", ctx(), params({ brakeFluidLastDone: "x" }))
        .errors.brakeFluidLastDone,
    ).toBeTruthy();
    expect(
      buildTemplate(
        "ac_service",
        ctx(),
        params({ acServiceLastDone: "2026-10-11" }),
      ).errors.acServiceLastDone,
    ).toBeTruthy();
  });

  it("does not look at the parameters of another template", () => {
    const { template, errors } = buildTemplate(
      "tires_summer",
      ctx(),
      params({ serviceDistance: "x", mfkDate: "", taxDay: "99" }),
    );
    expect(errors).toEqual({});
    expect(template).toBeDefined();
  });
});

describe("templateTitles", () => {
  it("are the titles the templates give their tasks, in German and in English", () => {
    for (const locale of ["de", "en"] as const) {
      const titles = new Map(
        vehicleTemplates({
          assetId: ASSET,
          firstRegistration: "2022-03-10",
          today: "2026-10-10",
          locale,
        }).map((t) => [t.id, t.task.title]),
      );
      for (const id of SETUP_TEMPLATE_IDS) {
        expect(templateTitles(id)).toContain(titles.get(id));
      }
    }
  });
});

describe("findExistingTask", () => {
  type T = Pick<
    Task,
    "id" | "title" | "category" | "assetId" | "trigger" | "state" | "archivedAt"
  >;

  const yearly: T["trigger"] = {
    v: 1,
    type: "calendar",
    freq: "yearly",
    interval: 1,
    byMonth: [10],
    byMonthDay: 15,
    startDate: "2026-10-15",
  };
  const task = (over: Partial<T> = {}): T => ({
    id: "t1",
    title: "Etwas anderes",
    category: "maintenance",
    assetId: ASSET,
    trigger: yearly,
    state: null,
    archivedAt: null,
    ...over,
  });
  const find = (id: (typeof SETUP_TEMPLATE_IDS)[number], tasks: T[]) =>
    findExistingTask(id, tasks, ASSET)?.id;

  it("finds a task with the title of the template, in either language and whatever the case", () => {
    expect(
      find("tires_winter", [task({ title: "Winterreifen aufziehen" })]),
    ).toBe("t1");
    expect(
      find("tires_winter", [task({ title: "switch to WINTER tires" })]),
    ).toBe("t1");
    expect(
      find("vignette", [task({ title: " Buy the motorway vignette " })]),
    ).toBe("t1");
  });

  it("does not take a task for another template", () => {
    expect(
      find("tires_summer", [task({ title: "Winterreifen aufziehen" })]),
    ).toBeUndefined();
    expect(find("vehicle_tax", [task()])).toBeUndefined();
  });

  it("finds the service by counting this vehicle's odometer, whatever it is called", () => {
    const counting = (assetId: string): T["trigger"] => ({
      v: 1,
      type: "counter_delta",
      entityId: odometerSignalKey(assetId),
      threshold: 15000,
    });
    expect(
      find("service", [task({ title: "Garage", trigger: counting(ASSET) })]),
    ).toBe("t1");
    expect(
      find("service", [
        task({ title: "Garage", trigger: counting(OTHER_ASSET) }),
      ]),
    ).toBeUndefined();
  });

  it("finds the inspection by its kind: a date in the category inspection", () => {
    const oneOff: T["trigger"] = { v: 1, type: "one_off", date: "2029-03-10" };
    expect(
      find("mfk", [
        task({
          title: "Fahrzeugkontrolle",
          category: "inspection",
          trigger: oneOff,
        }),
      ]),
    ).toBe("t1");
    expect(
      find("mfk", [task({ title: "Fahrzeugkontrolle", trigger: oneOff })]),
    ).toBeUndefined();
  });

  it("offers the inspection again once the one that exists is done", () => {
    const finished = task({
      title: "MFK (Motorfahrzeugkontrolle)",
      category: "inspection",
      trigger: { v: 1, type: "one_off", date: "2026-03-10" },
      state: {
        status: "ok",
        dueDate: null,
        reasons: ["completed"],
      } as unknown as T["state"],
    });
    expect(find("mfk", [finished])).toBeUndefined();
    const open = {
      ...finished,
      state: {
        ...finished.state,
        dueDate: "2026-03-10",
        reasons: [],
      } as unknown as T["state"],
    };
    expect(find("mfk", [open])).toBe("t1");
  });

  it("ignores archived tasks and the tasks of other things", () => {
    const title = "Winterreifen aufziehen";
    expect(
      find("tires_winter", [
        task({ title, archivedAt: "2026-01-01T00:00:00.000Z" }),
      ]),
    ).toBeUndefined();
    expect(
      find("tires_winter", [task({ title, assetId: OTHER_ASSET })]),
    ).toBeUndefined();
    expect(
      find("tires_winter", [task({ title, assetId: null })]),
    ).toBeUndefined();
  });

  it("returns the first match", () => {
    expect(
      find("tires_winter", [
        task({ id: "a", title: "Winterreifen aufziehen" }),
        task({ id: "b", title: "Winterreifen aufziehen" }),
      ]),
    ).toBe("a");
  });
});

describe("createTemplates", () => {
  const templates = (ids: (typeof SETUP_TEMPLATE_IDS)[number][]) =>
    ids.map((id) => buildTemplate(id, ctx(), params()).template!);
  const message = (err: unknown) => (err instanceof Error ? err.message : "?");

  function client(
    over: {
      failTask?: string[];
      failPrep?: boolean;
    } = {},
  ) {
    const calls: string[] = [];
    let n = 0;
    return {
      calls,
      client: {
        createTask: vi.fn(async (body: { title: string }) => {
          calls.push(`task:${body.title}`);
          if (over.failTask?.includes(body.title)) throw new Error("boom");
          n += 1;
          return { id: `id${n}` };
        }),
        createPreparation: vi.fn(
          async (
            taskId: string,
            body: { title: string; sortOrder?: number },
          ) => {
            calls.push(`prep:${taskId}:${body.title}:${body.sortOrder}`);
            if (over.failPrep) throw new Error("prep boom");
          },
        ),
      },
    };
  }

  it("creates each task, then its preparations in order, one template after the other", async () => {
    const { calls, client: c } = client();
    const runs = await createTemplates(
      templates(["tires_winter", "service"]),
      c,
      () => undefined,
      message,
    );
    expect(calls).toEqual([
      "task:Winterreifen aufziehen",
      "prep:id1:Garagentermin buchen:0",
      "task:Service",
    ]);
    expect(runs.map((r) => [r.id, r.state, r.taskId])).toEqual([
      ["tires_winter", "created", "id1"],
      ["service", "created", "id2"],
    ]);
  });

  it("reports running and then the result of every template", async () => {
    const { client: c } = client();
    const seen: TemplateRun[] = [];
    await createTemplates(
      templates(["service", "vignette"]),
      c,
      (run) => seen.push(run),
      message,
    );
    expect(seen.map((r) => `${r.id}:${r.state}`)).toEqual([
      "service:running",
      "service:created",
      "vignette:running",
      "vignette:created",
    ]);
  });

  it("goes on after a task that fails, and gives that one no preparations", async () => {
    const { calls, client: c } = client({
      failTask: ["Winterreifen aufziehen"],
    });
    const runs = await createTemplates(
      templates(["tires_winter", "tires_summer"]),
      c,
      () => undefined,
      message,
    );
    expect(runs.map((r) => [r.id, r.state, r.error])).toEqual([
      ["tires_winter", "failed", "boom"],
      ["tires_summer", "created", undefined],
    ]);
    expect(calls).toEqual([
      "task:Winterreifen aufziehen",
      "task:Sommerreifen aufziehen",
      "prep:id1:Garagentermin buchen:0",
    ]);
  });

  it("keeps a task whose preparation fails, and says which preparation", async () => {
    const { client: c } = client({ failPrep: true });
    const runs = await createTemplates(
      templates(["tires_winter"]),
      c,
      () => undefined,
      message,
    );
    expect(runs[0]).toMatchObject({
      state: "created",
      taskId: "id1",
      preparationErrors: [
        { title: "Garagentermin buchen", error: "prep boom" },
      ],
    });
  });

  it("does nothing for nothing", async () => {
    const { client: c } = client();
    expect(await createTemplates([], c, () => undefined, message)).toEqual([]);
    expect(c.createTask).not.toHaveBeenCalled();
  });
});
