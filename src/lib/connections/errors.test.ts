import { describe, expect, it } from "vitest";
import { ApiError } from "$lib/api/errors";
import { m } from "$lib/paraglide/messages";
import {
  connectionFieldErrors,
  connectionSaveMessage,
  integrationErrorMessage,
  pickerErrorMessage,
} from "./errors";

const UNKNOWN = integrationErrorMessage("no-such-code");

describe("integrationErrorMessage", () => {
  it("keeps the wording for Home Assistant by default", () => {
    expect(integrationErrorMessage("unauthorized")).toContain("Home Assistant");
  });

  it("speaks of Paperless-ngx for its own connection", () => {
    for (const code of [
      "unauthorized",
      "forbidden",
      "not_found",
      "timeout",
      "network",
      "tls",
      "version",
    ]) {
      const message = integrationErrorMessage(code, "paperless");
      expect(message, code).toContain("Paperless-ngx");
    }
  });

  it("knows the codes of a push that the connection never reports", () => {
    for (const code of ["duplicate", "interrupted", "file_missing"]) {
      expect(integrationErrorMessage(code, "paperless")).not.toBe(UNKNOWN);
    }
  });

  it("falls back to a general sentence for a code nobody knows", () => {
    expect(integrationErrorMessage(null, "paperless")).toBe(UNKNOWN);
    expect(integrationErrorMessage("no-such-code", "paperless")).toBe(UNKNOWN);
  });
});

describe("pickerErrorMessage", () => {
  it("explains the code the connected system failed with", () => {
    const err = new ApiError("upstream_error", "Bad gateway", {
      details: { code: "forbidden" },
    });
    expect(pickerErrorMessage(err, "paperless")).toBe(
      integrationErrorMessage("forbidden", "paperless"),
    );
  });

  it("uses the general API wording for anything else", () => {
    expect(
      pickerErrorMessage(new ApiError("not_found", "x"), "paperless"),
    ).toBe(m.error_not_found());
  });
});

describe("connectionSaveMessage", () => {
  it("names the host a member may not connect to", () => {
    const err = new ApiError(
      "forbidden",
      "The host docs.example.org is not on the list",
    );
    const message = connectionSaveMessage(
      err,
      "https://docs.example.org:8000/x",
    );
    expect(message).toContain("docs.example.org:8000");
    expect(message).not.toContain("The host");
  });

  it("falls back to the address as typed when it is no URL", () => {
    const message = connectionSaveMessage(
      new ApiError("forbidden", "x"),
      " docs.example.org ",
    );
    expect(message).toContain("docs.example.org");
  });

  it("uses the general wording for other failures", () => {
    expect(
      connectionSaveMessage(new Error("boom"), "https://x.example.org"),
    ).toBe(m.error_generic());
  });
});

describe("connectionFieldErrors", () => {
  const invalid = (fieldErrors: Record<string, string[]>) =>
    new ApiError("invalid_request", "Invalid request", {
      details: { body: { formErrors: [], fieldErrors } },
    });

  it("turns a refused address or token into a field message", () => {
    const errors = connectionFieldErrors(
      invalid({ baseUrl: ["English text"], token: ["English text"] }),
    );
    expect(Object.keys(errors).sort()).toEqual(["baseUrl", "token"]);
    expect(errors.baseUrl).not.toContain("English");
  });

  it("ignores fields it does not show and other errors", () => {
    expect(connectionFieldErrors(invalid({ config: ["x"] }))).toEqual({});
    expect(connectionFieldErrors(new ApiError("forbidden", "x"))).toEqual({});
    expect(connectionFieldErrors(new Error("boom"))).toEqual({});
  });
});
