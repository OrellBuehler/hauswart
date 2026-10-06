import type { PartMovementReason } from "$lib/api/enums";
import { m } from "$lib/paraglide/messages";

export const movementReasonLabels: Record<PartMovementReason, () => string> = {
  used: () => m.part_reason_used(),
  bought: () => m.part_reason_bought(),
  correction: () => m.part_reason_correction(),
};
