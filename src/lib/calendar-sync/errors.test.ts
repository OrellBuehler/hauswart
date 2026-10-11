import { describe, expect, it } from "vitest";
import { ApiError } from "$lib/api/errors";
import { integrationErrorMessage } from "$lib/connections/errors";
import { m } from "$lib/paraglide/messages";
import { deleteFailure, removalPausedTarget, saveFailure } from "./errors";

const calendarRefused = (code: string, message: string) =>
  new ApiError("invalid_request", "Invalid request", {
    details: {
      body: { formErrors: [], fieldErrors: { remoteCalendarId: [message] } },
      code,
    },
  });

const bodyFields = (fields: Record<string, string[]>) =>
  new ApiError("invalid_request", "Invalid request", {
    details: { body: { formErrors: [], fieldErrors: fields } },
  });

describe("saveFailure", () => {
  it("says on the calendar field that the calendar is not there", () => {
    const failure = saveFailure(
      calendarRefused("calendar_not_found", "This calendar was not found."),
      "homeassistant",
    );
    expect(failure.fields).toEqual({
      remoteCalendarId: m.caltargets_error_calendar_not_found({
        provider: m.integration_ha_name(),
      }),
    });
    expect(failure.form).toBe(m.form_check_fields());
  });

  it("says on the calendar field that the calendar takes no entries, in other words", () => {
    const failure = saveFailure(
      calendarRefused(
        "calendar_unsupported",
        "This calendar does not allow adding events.",
      ),
      "homeassistant",
    );
    expect(failure.fields).toEqual({
      remoteCalendarId: m.caltargets_error_calendar_unsupported(),
    });
    expect(m.caltargets_error_calendar_unsupported()).not.toBe(
      m.caltargets_error_calendar_not_found({ provider: "x" }),
    );
  });

  it("marks the calendar field without a reason when the server gave none", () => {
    const failure = saveFailure(
      bodyFields({ remoteCalendarId: ["Something"] }),
      "homeassistant",
    );
    expect(failure.fields).toEqual({ remoteCalendarId: m.field_invalid() });
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

  it("says a sync that is running keeps the entries from being removed for the moment", () => {
    const err = new ApiError("conflict", "x", { details: { code: "busy" } });
    expect(deleteFailure(err, "homeassistant")).toBe(
      m.caltargets_error_remove_busy(),
    );
  });

  it("reports how far a removal got when the target stays", () => {
    const err = new ApiError("upstream_error", "Too many", {
      details: {
        code: "too_many",
        deleted: 1000,
        remaining: 40,
        disabled: true,
      },
    });
    expect(deleteFailure(err, "homeassistant")).toBe(
      m.caltargets_error_remove_partial({ deleted: 1000, remaining: 40 }),
    );
  });

  it("says the target was switched off when a removal that failed half way left it so", () => {
    const err = new ApiError("upstream_error", "Bad gateway", {
      details: { code: "network", deleted: 3, remaining: 2, disabled: true },
    });
    expect(deleteFailure(err, "homeassistant")).toBe(
      m.caltargets_error_remove_paused({
        reason: integrationErrorMessage("network", "homeassistant"),
        deleted: 3,
        remaining: 2,
      }),
    );
    expect(removalPausedTarget(err)).toBe(true);
    expect(
      removalPausedTarget(
        new ApiError("upstream_error", "x", { details: { code: "timeout" } }),
      ),
    ).toBe(false);
    expect(removalPausedTarget(new Error("x"))).toBe(false);
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
