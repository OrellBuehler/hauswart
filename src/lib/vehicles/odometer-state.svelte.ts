import { api } from "$lib/api/browser";
import type { OdometerUnit } from "$lib/api/enums";
import { endpoints } from "$lib/api/registry";
import { apiErrorMessage } from "$lib/error-message";

export type VehicleReadingState =
  | { phase: "loading" }
  | { phase: "error"; message: string }
  | {
      phase: "ready";
      unit: OdometerUnit;
      latest: { value: number; date: string } | null;
    };

export class VehicleReading {
  state = $state.raw<VehicleReadingState>({ phase: "loading" });

  load(assetId: string): () => void {
    let cancelled = false;
    this.state = { phase: "loading" };
    api.call(endpoints.vehiclesGet, { params: { id: assetId } }).then(
      (vehicle) => {
        if (cancelled) return;
        this.state = {
          phase: "ready",
          unit: vehicle.odometerUnit,
          latest: vehicle.odometer
            ? { value: vehicle.odometer.value, date: vehicle.odometer.date }
            : null,
        };
      },
      (err) => {
        if (!cancelled) {
          this.state = { phase: "error", message: apiErrorMessage(err) };
        }
      },
    );
    return () => {
      cancelled = true;
    };
  }

  get unit(): OdometerUnit {
    return this.state.phase === "ready" ? this.state.unit : "km";
  }

  get known(): number | null {
    return this.state.phase === "ready"
      ? (this.state.latest?.value ?? null)
      : null;
  }
}
