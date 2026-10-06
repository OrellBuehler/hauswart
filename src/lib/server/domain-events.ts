import { registerPartsEvents } from "./parts/events";

/**
 * Wires the domains that react to events of others (stock bookings on task
 * completions, ...). Safe to call more than once; call it at startup and in
 * tests that exercise those reactions.
 */
export function registerDomainEventHandlers(): void {
  registerPartsEvents();
}
