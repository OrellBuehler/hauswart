import { describe, expect, it } from "vitest";
import { ApiError } from "$lib/api/errors";
import { integrationErrorMessage } from "$lib/connections/errors";
import { m } from "$lib/paraglide/messages";
import { deleteFailure, saveFailure } from "./errors";

const bodyFields = (fields: Record<string, string[]>) =>
  new ApiError("invalid_request", "Invalid request", {
    details: { body: { formErrors: [], fieldErrors: fields } },
  });

describe("saveFailure", () => {
  it("marks the calendar field when the calendar is not there or takes no entries", () => {
    const failure = saveFailure(
      bodyFields({ remoteCalendarId: ["This calendar was not found."] }),
      "homeassistant",
    );
    expect(failure.fields).toEqual({
      remoteCalendarId: m.caltargets_error_calendar_unusable(),
    });
    expect(failure.form).toBe(m.form_check_fields());
  });

  it("says the settings are not valid when only they are refused", () => {
    const failure = saveFailure(
      bodyFields({ config: ["A calendar of the household has no owner."] }),
      "homeassistant",
    );
    expect(failure.fields).toEqual({});
    expect(failure.form).toBe(m.caltargets_error_config());
  });

  it("marks other fields without echoing the server's English", () => {
    const failure = saveFailure(
      bodyFields({ name: ["Too long"] }),
      "homeassistant",
    );
    expect(failure.fields).toEqual({ name: m.field_invalid() });
    expect(failure.form).toBe(m.form_check_fields());
  });

  it("says a calendar that has a target already cannot be added again", () => {
    const failure = saveFailure(
      new ApiError("conflict", "This calendar already has a target."),
      "homeassistant",
    );
    expect(failure.fields).toEqual({
      remoteCalendarId: m.caltargets_error_calendar_taken(),
    });
    expect(failure.form).toBeUndefined();
  });

  it("explains a refusal for a member", () => {
    expect(
      saveFailure(
        new ApiError("forbidden", "Only administrators"),
        "homeassistant",
      ).form,
    ).toBe(m.caltargets_error_forbidden());
  });

  it("names the system when its connection is missing", () => {
    expect(
      saveFailure(
        new ApiError("not_found", "Connection not found"),
        "homeassistant",
      ).form,
    ).toBe(
      m.caltargets_error_no_connection({ provider: m.integration_ha_name() }),
    );
  });

  it("words what the connected system answered", () => {
    const err = new ApiError("upstream_error", "Bad gateway", {
      details: { code: "timeout" },
    });
    expect(saveFailure(err, "homeassistant").form).toBe(
      integrationErrorMessage("timeout", "homeassistant"),
    );
  });

  it("falls back to the general wording", () => {
    expect(saveFailure(new Error("boom"), "homeassistant").form).toBe(
      m.error_generic(),
    );
    expect(
      saveFailure(new ApiError("rate_limited", "x"), "homeassistant").form,
    ).toBe(m.error_rate_limited());
  });
});

describe("deleteFailure", () => {
  it("says a calendar that cannot delete cannot take its entries out", () => {
    const err = new ApiError("invalid_request", "Invalid request", {
      details: {
        query: { formErrors: [], fieldErrors: { removeRemote: ["x"] } },
      },
    });
    expect(deleteFailure(err, "homeassistant")).toBe(
      m.caltargets_error_remove_unsupported(),
    );
  });

  it("says a switched-off connection cannot remove entries", () => {
    expect(deleteFailure(new ApiError("conflict", "x"), "homeassistant")).toBe(
      m.caltargets_error_remove_offline(),
    );
  });

  it("reports how far a removal got when the target stays", () => {
    const err = new ApiError("upstream_error", "Too many", {
      details: { code: "too_many", deleted: 1000, remaining: 40 },
    });
    expect(deleteFailure(err, "homeassistant")).toBe(
      m.caltargets_error_remove_partial({ deleted: 1000, remaining: 40 }),
    );
  });

  it("words a failure of the system and says the target stays", () => {
    const err = new ApiError("upstream_error", "Bad gateway", {
      details: { code: "network" },
    });
    expect(deleteFailure(err, "homeassistant")).toBe(
      m.caltargets_error_remove_failed({
        reason: integrationErrorMessage("network", "homeassistant"),
      }),
    );
  });

  it("covers a target that is gone and a member", () => {
    expect(deleteFailure(new ApiError("not_found", "x"), "homeassistant")).toBe(
      m.caltargets_error_gone(),
    );
    expect(deleteFailure(new ApiError("forbidden", "x"), "homeassistant")).toBe(
      m.caltargets_error_forbidden(),
    );
    expect(deleteFailure(new Error("x"), "homeassistant")).toBe(
      m.error_generic(),
    );
  });
});
