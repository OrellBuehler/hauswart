import type { GuestLinkStatus, GuestSection } from "$lib/api/enums";
import { m } from "$lib/paraglide/messages";

export const guestSectionLabels: Record<GuestSection, () => string> = {
  emergency: () => m.glinks_section_emergency(),
  rules: () => m.glinks_section_rules(),
  contacts: () => m.glinks_section_contacts(),
  devices: () => m.glinks_section_devices(),
  howto: () => m.glinks_section_howto(),
};

export const guestSectionHints: Record<GuestSection, () => string> = {
  emergency: () => m.glinks_section_emergency_hint(),
  rules: () => m.glinks_section_rules_hint(),
  contacts: () => m.glinks_section_contacts_hint(),
  devices: () => m.glinks_section_devices_hint(),
  howto: () => m.glinks_section_howto_hint(),
};

export const guestStatusLabels: Record<GuestLinkStatus, () => string> = {
  active: () => m.glinks_status_active(),
  scheduled: () => m.glinks_status_scheduled(),
  expired: () => m.glinks_status_expired(),
  revoked: () => m.glinks_status_revoked(),
};

/** Badge tone per status, readable in light and dark. */
export const guestStatusTones: Record<GuestLinkStatus, string> = {
  active: "border-success/30 bg-success/10 text-success",
  scheduled: "border-warning/40 bg-warning/10 text-warning",
  expired: "text-muted-foreground",
  revoked: "border-destructive/30 bg-destructive/10 text-destructive",
};

/** Random numeric PIN of 6 digits. */
export function generatePin(length = 6): string {
  const values = crypto.getRandomValues(new Uint32Array(length));
  return Array.from(values, (v) => String(v % 10)).join("");
}
