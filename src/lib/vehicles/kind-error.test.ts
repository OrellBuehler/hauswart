import { describe, expect, it } from "vitest";
import { ApiError } from "$lib/api/errors";
import { vehicleKindError } from "./kind-error";

const refused = (message: string, field = "kind") =>
  new ApiError("invalid_request", "Invalid request", {
    details: { body: { formErrors: [], fieldErrors: { [field]: [message] } } },
  });

describe("vehicleKindError", () => {
  it("names what the vehicle still holds, in the app's language", () => {
    const one = vehicleKindError(
      refused("Remove the vehicle's tire sets before changing its kind"),
    );
    expect(one).toContain("Reifensätze");
    expect(one).not.toContain("tire sets");

    const three = vehicleKindError(
      refused(
        "Remove the vehicle's saved details, odometer readings and tire sets before changing its kind",
      ),
    );
    expect(three).toContain("Fahrzeugangaben");
    expect(three).toContain("Kilometerstände");
    expect(three).toContain("Reifensätze");
  });

  it("still answers when the wording is one it does not know", () => {
    const text = vehicleKindError(refused("Something else about the kind"));
    expect(text).toBeTruthy();
    expect(text).not.toContain("Something else");
  });

  it("is null for a field error on another field and for other errors", () => {
    expect(
      vehicleKindError(refused("Remove the vehicle's tire sets", "name")),
    ).toBeNull();
    expect(vehicleKindError(new ApiError("not_found", "nope"))).toBeNull();
    expect(vehicleKindError(new Error("boom"))).toBeNull();
    expect(vehicleKindError(undefined)).toBeNull();
  });
});
