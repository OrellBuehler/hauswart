import type { z } from "zod";
import { toIso } from "$lib/api/schemas/common";
import type {
  calendarFeedSchema,
  emergencySchema,
  guestLinkSchema,
} from "$lib/api/schemas/share";
import { feedUrl, type FeedRecord } from "$lib/server/calendar/feeds";
import type { EmergencyRecord } from "$lib/server/emergency/emergency";
import type { GuestLinkRecord } from "$lib/server/share/guest-links";
import { wireContact } from "./wire";

const iso = (value: Date | null): string | null =>
  value ? toIso(value) : null;

export function wireCalendarFeed(
  feed: FeedRecord,
  origin: string,
): z.input<typeof calendarFeedSchema> {
  return {
    id: feed.id,
    name: feed.name,
    scope: feed.scope,
    includeEstimated: feed.includeEstimated,
    includePreparations: feed.includePreparations,
    includeDefects: feed.includeDefects,
    includeWarranties: feed.includeWarranties,
    alarmTime: feed.alarmTime,
    alarmDaysBefore: feed.alarmDaysBefore,
    locale: feed.locale,
    url: feed.token ? feedUrl(origin, feed.token) : null,
    lastFetchedAt: iso(feed.lastFetchedAt),
    createdAt: toIso(feed.createdAt),
    updatedAt: toIso(feed.updatedAt),
  };
}

export function wireGuestLink(
  link: GuestLinkRecord,
): z.input<typeof guestLinkSchema> {
  return {
    id: link.id,
    label: link.label,
    status: link.status,
    createdBy: link.createdBy,
    createdByName: link.createdByName,
    startsAt: iso(link.startsAt),
    expiresAt: toIso(link.expiresAt),
    revokedAt: iso(link.revokedAt),
    hasPin: link.hasPin,
    pinLocked: link.pinLocked,
    includeSecrets: link.includeSecrets,
    sections: link.sections,
    pageIds: link.pageIds,
    locale: link.locale,
    lastViewedAt: iso(link.lastViewedAt),
    viewCount: link.viewCount,
    createdAt: toIso(link.createdAt),
    updatedAt: toIso(link.updatedAt),
  };
}

export const guestLinkUrl = (origin: string, token: string) =>
  `${origin}/g/${token}`;

export function wireEmergency(
  record: EmergencyRecord,
): z.input<typeof emergencySchema> {
  return {
    household: { name: record.householdName },
    pages: record.pages.map((p) => ({
      id: p.id,
      slug: p.slug,
      title: p.title,
      section: p.section,
      renderedHtml: p.renderedHtmlMember,
      updatedAt: toIso(p.updatedAt),
    })),
    contacts: record.contacts.map(wireContact),
    assets: record.assets.map((a) => ({
      id: a.id,
      name: a.name,
      roomName: a.roomName,
      pinnedHints: a.pinnedHints.map((h) => ({
        id: h.id,
        title: h.title,
        bodyMd: h.bodyMd,
        kind: h.kind,
      })),
    })),
    insurance: record.insurance,
  };
}
