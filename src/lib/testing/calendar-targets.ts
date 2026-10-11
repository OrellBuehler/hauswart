import type {
  CalendarSyncCounts,
  CalendarTarget,
  CalendarTargetCapabilities,
  CalendarTargetConfig,
} from "$lib/api/schemas/calendar-sync";

/** A calendar that creates, changes and deletes, like Home Assistant's Local Calendar. */
export const FULL_CAPABILITIES: CalendarTargetCapabilities = {
  create: true,
  update: true,
  delete: true,
  alarms: false,
};

/** A calendar that only takes new events, like a CalDAV one in Home Assistant. */
export const CREATE_ONLY_CAPABILITIES: CalendarTargetCapabilities = {
  create: true,
  update: false,
  delete: false,
  alarms: false,
};

export function countsDto(
  over: Partial<CalendarSyncCounts> = {},
): CalendarSyncCounts {
  return {
    created: 0,
    updated: 0,
    replaced: 0,
    deleted: 0,
    adopted: 0,
    forgotten: 0,
    skipped: 0,
    failed: 0,
    unconfirmed: 0,
    remaining: 0,
    ...over,
  };
}

export function configDto(
  over: Partial<CalendarTargetConfig> = {},
): CalendarTargetConfig {
  return {
    kinds: ["appointments", "task_due"],
    direction: "push",
    scope: "all",
    timedMode: "all_day",
    dueTime: "08:00",
    dueDurationMinutes: 30,
    alarmMinutes: null,
    titlePrefix: "",
    onRemoteDelete: "recreate",
    conflictPolicy: "hauswart_wins",
    locale: "de",
    ...over,
  };
}

/** A household target in a synthetic calendar, synced a minute ago. */
export function targetDto(over: Partial<CalendarTarget> = {}): CalendarTarget {
  return {
    id: "target-1",
    provider: "homeassistant",
    level: "household",
    ownerId: null,
    remoteCalendarId: "calendar.example_household",
    remoteName: "Haushalt",
    name: "Haushaltskalender",
    enabled: true,
    config: configDto(),
    capabilities: FULL_CAPABILITIES,
    status: "ok",
    lastError: null,
    lastOkAt: "2026-10-11T08:00:00.000Z",
    lastCheckedAt: "2026-10-11T08:00:00.000Z",
    nextAttemptAt: "2026-10-11T08:15:00.000Z",
    consecutiveFailures: 0,
    lastStats: countsDto({ created: 3 }),
    eventCount: 3,
    canManage: true,
    createdAt: "2026-10-01T08:00:00.000Z",
    updatedAt: "2026-10-01T08:00:00.000Z",
    ...over,
  };
}
