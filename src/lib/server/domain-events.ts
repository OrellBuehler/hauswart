import { registerAssetNoteEvents } from "./asset-notes/events";
import { registerDomainAttachmentOwners } from "./attachments/domain-owners";
import { registerPartsEvents } from "./parts/events";
import { registerVehicleEvents } from "./vehicles/events";

/**
 * Wires the domains that react to events of others (stock bookings, odometer readings and
 * reopened asset notes on task completions, ...) and registers the attachment owner types of the domains
 * (defects, service log, parts, hints, contacts). Safe to call more than
 * once; call it at startup and in tests that exercise those reactions.
 */
export function registerDomainEventHandlers(): void {
  registerPartsEvents();
  registerVehicleEvents();
  registerAssetNoteEvents();
  registerDomainAttachmentOwners();
}
