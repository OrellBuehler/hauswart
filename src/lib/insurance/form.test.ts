import { describe, expect, it } from "vitest";
import type { InsurancePolicy } from "$lib/api/schemas/insurance";
import {
  buildCreateBody,
  buildUpdateBody,
  coverableAssets,
  draftDeadline,
  draftFromPolicy,
  newDraft,
  parseNoticeMonths,
  type PolicyDraft,
} from "./form";

function draft(over: Partial<PolicyDraft> = {}): PolicyDraft {
  return {
    ...newDraft({ today: "2026-10-10", currency: "CHF" }),
    title: "Privathaftpflicht",
    premium: "245.50",
    ...over,
  };
}

function policy(over: Partial<InsurancePolicy> = {}): InsurancePolicy {
  return {
    id: "p1",
    title: "Privathaftpflicht",
    type: "personal_liability",
    insurerContactId: "c1",
    insurerName: "Musterversicherung AG",
    policyNumber: "A-0000-00",
    premiumMinor: 24550,
    currency: "CHF",
    premiumPeriod: "annual",
    annualPremiumMinor: 24550,
    deductibleMinor: 50000,
    startDate: "2024-01-01",
    endDate: "2026-12-31",
    renewal: "auto",
    cancellationNoticeMonths: 3,
    cancellationDeadline: "2026-09-30",
    assistancePhone: null,
    showOnEmergency: false,
    notes: null,
    assets: [{ id: "a1", name: "Familienauto", kind: "vehicle" }],
    reminderTaskId: null,
    commentCount: 0,
    archivedAt: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...over,
  };
}

describe("a new draft", () => {
  it("starts today, yearly and renewing by itself, in the household currency", () => {
    const fresh = newDraft({ today: "2026-10-10", currency: "EUR" });
    expect(fresh).toMatchObject({
      startDate: "2026-10-10",
      endDate: "",
      renewal: "auto",
      premiumPeriod: "annual",
      currency: "EUR",
      type: "other",
      assetIds: [],
      showOnEmergency: false,
    });
  });

  it("takes what the address prefilled", () => {
    const fresh = newDraft({
      today: "2026-10-10",
      currency: "CHF",
      type: "motor_liability",
      assetIds: ["a1"],
    });
    expect(fresh.type).toBe("motor_liability");
    expect(fresh.assetIds).toEqual(["a1"]);
  });
});

describe("buildCreateBody", () => {
  it("turns the draft into a request with the amounts in minor units", () => {
    const { body, errors } = buildCreateBody(
      draft({
        deductible: "500",
        endDate: "2026-12-31",
        noticeMonths: "3",
        policyNumber: " A-0000-00 ",
        assetIds: ["a1", "a2"],
        insurerContactId: "c1",
      }),
    );
    expect(errors).toEqual({});
    expect(body).toMatchObject({
      title: "Privathaftpflicht",
      premiumMinor: 24550,
      deductibleMinor: 50000,
      currency: "CHF",
      premiumPeriod: "annual",
      startDate: "2026-10-10",
      endDate: "2026-12-31",
      renewal: "auto",
      cancellationNoticeMonths: 3,
      policyNumber: "A-0000-00",
      assetIds: ["a1", "a2"],
      insurerContactId: "c1",
    });
  });

  it("sends empty optional fields as null", () => {
    const { body } = buildCreateBody(draft());
    expect(body).toMatchObject({
      deductibleMinor: null,
      endDate: null,
      cancellationNoticeMonths: null,
      policyNumber: null,
      assistancePhone: null,
      notes: null,
      insurerContactId: null,
    });
  });

  it("reads amounts the way people write them", () => {
    expect(
      buildCreateBody(draft({ premium: "1'234,5" })).body?.premiumMinor,
    ).toBe(123450);
    expect(buildCreateBody(draft({ premium: "0" })).body?.premiumMinor).toBe(0);
  });

  it("uses the currency's own precision", () => {
    expect(
      buildCreateBody(draft({ currency: "JPY", premium: "12000" })).body
        ?.premiumMinor,
    ).toBe(12000);
    const { errors } = buildCreateBody(
      draft({ currency: "JPY", premium: "12.5" }),
    );
    expect(errors.premiumMinor).toBeTruthy();
  });

  it("collects every problem at once under the name of the request field", () => {
    const { body, errors } = buildCreateBody(
      draft({
        title: "  ",
        premium: "",
        deductible: "abc",
        startDate: "",
        noticeMonths: "x",
      }),
    );
    expect(body).toBeUndefined();
    expect(Object.keys(errors).sort()).toEqual([
      "cancellationNoticeMonths",
      "deductibleMinor",
      "premiumMinor",
      "startDate",
      "title",
    ]);
  });

  it("refuses an end before the start", () => {
    const { body, errors } = buildCreateBody(
      draft({ startDate: "2026-10-10", endDate: "2026-10-09" }),
    );
    expect(body).toBeUndefined();
    expect(errors.endDate).toBeTruthy();
  });

  it("accepts an end on the start day", () => {
    const { body } = buildCreateBody(
      draft({ startDate: "2026-10-10", endDate: "2026-10-10" }),
    );
    expect(body?.endDate).toBe("2026-10-10");
  });

  it("refuses a negative premium, a long notice period and a bad currency", () => {
    expect(
      buildCreateBody(draft({ premium: "-5" })).errors.premiumMinor,
    ).toBeTruthy();
    expect(
      buildCreateBody(draft({ noticeMonths: "121" })).errors
        .cancellationNoticeMonths,
    ).toBeTruthy();
    expect(
      buildCreateBody(draft({ currency: "ch" })).errors.currency,
    ).toBeTruthy();
  });

  it("accepts a notice period of zero months", () => {
    expect(
      buildCreateBody(draft({ noticeMonths: "0" })).body
        ?.cancellationNoticeMonths,
    ).toBe(0);
  });
});

describe("draftFromPolicy", () => {
  it("round-trips: an untouched form changes nothing", () => {
    const stored = policy({
      assistancePhone: "+41 00 000 00 00",
      notes: "Zeile 1\nZeile 2",
      showOnEmergency: true,
    });
    const { body, errors } = buildUpdateBody(draftFromPolicy(stored), stored);
    expect(errors).toEqual({});
    expect(body).toEqual({});
  });

  it("writes amounts with the currency's decimals", () => {
    const filled = draftFromPolicy(policy({ premiumMinor: 24550 }));
    expect(filled.premium).toBe("245.50");
    expect(filled.deductible).toBe("500.00");
    expect(draftFromPolicy(policy({ deductibleMinor: null })).deductible).toBe(
      "",
    );
  });
});

describe("buildUpdateBody", () => {
  const stored = policy();

  it("sends only what changed", () => {
    const { body } = buildUpdateBody(
      { ...draftFromPolicy(stored), premium: "250", endDate: "2027-12-31" },
      stored,
    );
    expect(body).toEqual({ premiumMinor: 25000, endDate: "2027-12-31" });
  });

  it("clears an optional field with null", () => {
    const { body } = buildUpdateBody(
      {
        ...draftFromPolicy(stored),
        deductible: "",
        policyNumber: "",
        insurerContactId: null,
        endDate: "",
      },
      stored,
    );
    expect(body).toEqual({
      deductibleMinor: null,
      policyNumber: null,
      insurerContactId: null,
      endDate: null,
    });
  });

  it("replaces the covered assets as a whole, and only when the set changed", () => {
    const same = buildUpdateBody(
      { ...draftFromPolicy(stored), assetIds: ["a1"] },
      stored,
    );
    expect(same.body).toEqual({});
    const reordered = buildUpdateBody(
      { ...draftFromPolicy(stored), assetIds: ["a2", "a1"] },
      policy({
        assets: [
          { id: "a1", name: "Familienauto", kind: "vehicle" },
          { id: "a2", name: "Fahrrad", kind: "other" },
        ],
      }),
    );
    expect(reordered.body).toEqual({});
    const changed = buildUpdateBody(
      { ...draftFromPolicy(stored), assetIds: ["a2"] },
      stored,
    );
    expect(changed.body).toEqual({ assetIds: ["a2"] });
  });

  it("reports the problems of the draft instead of a body", () => {
    const { body, errors } = buildUpdateBody(
      { ...draftFromPolicy(stored), title: "", premium: "x" },
      stored,
    );
    expect(body).toBeUndefined();
    expect(Object.keys(errors).sort()).toEqual(["premiumMinor", "title"]);
  });
});

describe("parseNoticeMonths", () => {
  it.each([
    ["", null],
    ["  ", null],
    ["3", 3],
    [" 12 ", 12],
    ["0", 0],
    ["-1", undefined],
    ["2.5", undefined],
    ["drei", undefined],
  ] as const)("%j is %j", (text, expected) => {
    expect(parseNoticeMonths(text)).toBe(expected);
  });
});

describe("draftDeadline", () => {
  const terms = (over: Partial<PolicyDraft> = {}) => ({
    renewal: "auto" as const,
    endDate: "2026-12-31",
    noticeMonths: "3",
    ...over,
  });

  it("is the end date minus the notice period, like the server derives it", () => {
    expect(draftDeadline(terms())).toBe("2026-09-30");
    expect(draftDeadline(terms({ noticeMonths: "6" }))).toBe("2026-06-30");
    expect(draftDeadline(terms({ endDate: "2026-05-31" }))).toBe("2026-02-28");
  });

  it("is the end date itself without a notice period in months", () => {
    expect(draftDeadline(terms({ noticeMonths: "0" }))).toBe("2026-12-31");
  });

  it.each([
    ["a fixed term", { renewal: "fixed" as const }],
    ["no end date", { endDate: "" }],
    ["an end that is not a date", { endDate: "2026-02-30" }],
    ["no notice period", { noticeMonths: "" }],
    ["a notice period that is no number", { noticeMonths: "x" }],
    ["a notice period beyond ten years", { noticeMonths: "121" }],
  ])("is none for %s", (_name, over) => {
    expect(draftDeadline(terms(over))).toBeNull();
  });
});

describe("coverableAssets", () => {
  const asset = (
    id: string,
    name: string,
    archivedAt: string | null = null,
  ) => ({
    id,
    name,
    kind: "device" as const,
    roomName: null,
    archivedAt,
  });

  it("lists active assets by name", () => {
    const items = coverableAssets([
      asset("a2", "Waschmaschine"),
      asset("a1", "Boiler"),
      asset("a3", "Alter Herd", "2026-01-01T00:00:00.000Z"),
    ]);
    expect(items.map((item) => item.name)).toEqual(["Boiler", "Waschmaschine"]);
  });

  it("keeps what the policy covers even when archived or not listed at all", () => {
    const items = coverableAssets(
      [asset("a1", "Boiler", "2026-01-01T00:00:00.000Z")],
      {
        assets: [
          { id: "a1", name: "Boiler", kind: "device" },
          { id: "a9", name: "Fehlt in der Liste", kind: "other" },
        ],
      },
    );
    expect(items.map((item) => item.id).sort()).toEqual(["a1", "a9"]);
  });
});
