import { describe, expect, it } from "vitest";
import { createTaskRequestSchema } from "$lib/api/schemas/tasks";
import {
  VEHICLE_TEMPLATE_IDS,
  VEHICLE_TEMPLATE_SOURCE,
  templateMark,
  templateOfMark,
} from "./template-mark";

const ASSET = "6f1c2d3e-0000-4000-8000-000000000001";

describe("templateMark", () => {
  it("is the vehicle and the template, under the source of the templates", () => {
    expect(templateMark(ASSET, "tires_winter")).toEqual({
      externalSource: "vehicle_template",
      externalRef: `${ASSET}:tires_winter`,
    });
    expect(VEHICLE_TEMPLATE_SOURCE).toBe("vehicle_template");
  });

  it("numbers the later tasks of the same template, since the pair is unique on the server", () => {
    expect(templateMark(ASSET, "mfk", 1).externalRef).toBe(`${ASSET}:mfk`);
    expect(templateMark(ASSET, "mfk", 2).externalRef).toBe(`${ASSET}:mfk:2`);
    expect(templateMark(ASSET, "mfk", 13).externalRef).toBe(`${ASSET}:mfk:13`);
  });

  it("is accepted when a task is created", () => {
    const result = createTaskRequestSchema.safeParse({
      title: "x",
      trigger: { v: 1, type: "one_off", date: "2027-01-01" },
      ...templateMark(ASSET, "ac_service", 99),
    });
    expect(result.error?.issues).toBeUndefined();
  });
});

describe("templateOfMark", () => {
  it.each([
    ["the first task", `${ASSET}:tires_winter`, "tires_winter"],
    ["a later task", `${ASSET}:vehicle_tax:3`, "vehicle_tax"],
    ["any template id", `${ASSET}:ac_service:12`, "ac_service"],
  ])("reads %s", (_name, externalRef, id) => {
    expect(
      templateOfMark({ externalSource: "vehicle_template", externalRef }),
    ).toBe(id);
  });

  it("reads back what templateMark wrote", () => {
    for (const n of [1, 2, 40]) {
      expect(templateOfMark(templateMark(ASSET, "service", n))).toBe("service");
    }
  });

  it.each([
    ["no mark", {}],
    ["empty fields", { externalSource: null, externalRef: null }],
    [
      "another source",
      { externalSource: "seed", externalRef: `${ASSET}:tires_winter` },
    ],
    [
      "a reference without a template",
      { externalSource: "vehicle_template", externalRef: ASSET },
    ],
    [
      "a reference that is not ours",
      { externalSource: "vehicle_template", externalRef: "x:y:z:w" },
    ],
    [
      "a trailing number that is no count",
      { externalSource: "vehicle_template", externalRef: `${ASSET}:mfk:x` },
    ],
    ["no reference", { externalSource: "vehicle_template", externalRef: null }],
    [
      "a template that does not exist",
      { externalSource: "vehicle_template", externalRef: `${ASSET}:tire_swap` },
    ],
    [
      "a template id that only starts like one",
      {
        externalSource: "vehicle_template",
        externalRef: `${ASSET}:tires_winter_2:3`,
      },
    ],
    [
      "a template id in capitals",
      { externalSource: "vehicle_template", externalRef: `${ASSET}:SERVICE` },
    ],
  ])("is null for %s", (_name, task) => {
    expect(templateOfMark(task)).toBeNull();
  });

  it("knows every template of the vehicle setup", () => {
    for (const id of VEHICLE_TEMPLATE_IDS) {
      expect(templateOfMark(templateMark(ASSET, id, 2))).toBe(id);
    }
  });
});
