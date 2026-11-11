---
paths:
  - "src/lib/server/calendar-sync/**"
  - "src/lib/server/calendar/**"
  - "src/lib/calendar-sync/**"
  - "src/lib/server/integrations/homeassistant/calendar-*.ts"
  - "src/lib/api/schemas/calendar-sync.ts"
  - "src/lib/server/api/handlers/calendarTargets.ts"
  - "src/routes/api/v1/calendar-targets/**"
  - "src/lib/components/calendar-sync/**"
  - "src/routes/*/settings/calendar/**"
  - "mcp/src/tools/calendar-targets.ts"
---

# Calendar sync

Pushes appointments, due dates, preparations and deadlines into a calendar of a connected system, so they show up next to everything else
people plan. Optional like every adapter: without a target nothing happens, and the core knows no calendar system by name.

- **The seam** (`calendar-sync/provider.ts`): an adapter calls `registerCalendarProvider({kind, listCalendars, open, fingerprint?})` (`kind` is in
  `CALENDAR_PROVIDERS` in `enums.ts`, and is also an integration kind). `open(connection, calendarId)` resolves the calendar once per run
  and returns a `CalendarSession`: `name`, `capabilities` `{create, update, delete, alarms}`, `listEvents(range)` (every event, ours with
  a `ref`, foreign ones with `ref: null`), `create(item)` (answers `{uid}`, or `uid: null` when the system does not tell),
  `update(uid, item)` and `delete(uid)`. All throw `IntegrationError(code, message)`. A `CalendarItem` is `ref`, `summary`, `description`
  (no marker), `location`, `when` (`{allDay, startDate, endDate}` with an **exclusive** end, or `{startsAt, endsAt}` instants), `path`
  (`/tasks/<id>`, the provider may add the app address) and `alarmMinutes`. A CalDAV adapter plugs in with no core change: it hands back
  `ref` from wherever it keeps it (the UID, an X-property), returns the `uid` it chose from `create`, and sets `alarms: true` to receive
  `alarmMinutes`.
- **Tables** (migrations `0024_calendar_sync`, `0025_calendar_target_remote_name`): `calendar_targets` holds the connection, provider, `remoteCalendarId`, `remoteName` (the calendar's own
  name as the system last reported it, updated by every run; `name` is the target's, given when it was added), name, `level`
  (`household|user`) with the `userId` the check requires, `enabled`, `configJson`, `capabilitiesJson` (from the last time the calendar was
  opened) and the health: `status`, `lastError` code, `lastOkAt`, `lastCheckedAt` (the last attempt), `consecutiveFailures`, `lastStatsJson` (null for a run that failed before it counted anything). The API adds `nextAttemptAt`: `lastCheckedAt` plus the back-off after failures, else plus 15 minutes (`schedule.ts`), null for a target that is off or was never tried.
  It is **unique per provider and calendar**, because two targets in one calendar would delete each other's events. `calendar_links` holds
  target, `kind`, `itemId`, `instanceKey`, `ref`, `remoteUid` (nullable), `status` (`synced|forgotten`), `contentHash` and `lastPushedAt`,
  unique per target, kind, item and occurrence. Deleting the connection or the person removes their targets and links; events already in the
  calendar stay.
- **Level** follows the connection: a household kind (Home Assistant) gives household targets, managed by administrators and visible to
  everybody (`canManage` says which); a per-person kind gives targets of that person, invisible to others (404). `scope` `mine` (tasks and
  appointments of the owner or of nobody) is only for personal targets; a household target is always `all` (400 on `config` otherwise).
- **Config** (`calendarTargetConfigSchema`): `kinds` is required, a non-empty set of `appointments`, `task_due`, `preparations`,
  `defect_deadlines`, `insurance_deadlines` and `warranty_ends`. `direction` is only `push`: `pull` and `both` are rejected rather than
  accepted and ignored, so the field can widen later without a lie in between. Then `scope`, `timedMode` (`all_day|timed`) with `dueTime`
  (08:00) and `dueDurationMinutes` (30) for items that only have a date (a multi-day span stays all-day), `alarmMinutes` (null),
  `titlePrefix`, `onRemoteDelete` (`recreate|forget`), `conflictPolicy` (only `hauswart_wins`: edits in the calendar are not detected, an
  event is only written again when the item changes in hauswart; `remote_wins` needs the pull direction) and `locale` (the language of
  generated titles and descriptions).
- **One reading** (`calendar/entries.ts` `readCalendarEntries`): the iCal feed and sync share it, so they cannot disagree about what is in a
  calendar. Entries carry titles, places and dates only: never task descriptions, notes, comments, policy numbers or secrets (a test plants
  text in every one of them). A defect's or policy's own entry stands for its reminder task when that kind is carried (`skipTaskSources`).
  `insurance_deadlines` is the cancellation deadline of an active policy (`insurance-<id>-cancel`), from today on. UIDs are `task-<id>-<occurrence>`,
  `prep-...`, `appointment-<id>`, `defect-<id>-deadline`, `warranty-<id>`: a completed occurrence is another item than the next one.
- **Items** (`items.ts` `buildDesiredItems`): the entries inside the horizon (31 days back to 400 ahead; estimates are never carried), with the
  prefix, timing and reminder of the target, sorted by start. `hash` = sha256 (32 hex) of ref, summary, description, location, when, path,
  alarm and the provider's fingerprint; it does not depend on `updatedAt`. The reminder is only part of an item for a calendar with
  `capabilities.alarms` (a provider that keeps none never has its events rewritten for it), and the fingerprint is what the provider adds on top
  of the item (`CalendarProvider.fingerprint(connection.config)`, no calendar call; for Home Assistant the app address its links are built
  from), so a changed `appUrl` or `ORIGIN` writes the events again once. `itemSettingsOf` gives the scheduler the same settings a run builds.
- **The marker** (`ref.ts`): an event is ours only if its description (or the provider's own field) carries `hw-ref: <ref>@sync.hauswart`.
  The engine never names an event without it, whatever its id says. Text that merely mentions it does not count (the whole line must match).
- **Reconcile** (`reconcile.ts`, pure, table-tested including a simulated calendar that must settle in at most three passes): per ref,
  from desired items, links, the events found and the capabilities. Wanted and found: nothing when the link's hash is the item's, else
  `update`; without update but with create and delete `replace` (delete, then write; the link is dropped in between so a failed write
  is simply written again); create-only calendars keep the old event and only remember the new hash (`acknowledge`, so it is not tried
  every minute). Wanted, linked, not found: somebody deleted it; `recreate` writes it again, `forget` keeps a `forgotten` link that is
  never written again until the item is gone. A link without an id that is not found (written a moment ago) is waited for, never written
  twice (`unconfirmed`), but for 30 minutes after it was pushed (`UNCONFIRMED_GRACE_MS`, from `lastPushedAt`): after that it counts as
  deleted like any other (`onRemoteDelete`), which is how a target recovers once a calendar keeps the marker again (the events it dropped
  the marker from stay in the calendar as foreign ones).
  A calendar that lists events without ids keeps them as they are: the link remembers `NO_UID` (`''`), such an event is neither changed nor deleted (the link goes when its item goes).
  Not wanted: the event is deleted when the calendar allows and it was found (otherwise only the link goes), including events of
  ours that nothing remembers when their kind is carried; duplicates of one ref keep the one the link names. The result is a mirror of the
  horizon: an occurrence that was completed disappears from the calendar. Steps are ordered delete, change, create, each by date.
- **A run** (`sync.ts` `syncTarget`): open, read the events of the horizon plus two days, reconcile, apply with at most 100 calendar calls
  (a replace is two; `counts.remaining` says how many steps are left; the scheduler goes on at once), save the link after every step, then look the ids of new events up
  by their marker (`uid: null` creates): the first such create of a run is looked up at once, and when the marker did not survive (a
  calendar that drops the description) the run stops with `unconfirmed`, so such a calendar gets one stray event per run and not one per
  item; the ids of the others are looked up together at the end. A refusal of the system (`unauthorized`, `forbidden`, `network`, `timeout`, `tls`, `server`, ...)
  stops the calls, any other failure is counted and the rest goes on; five failures stop too. A delete that finds its event gone has done what it should; a change that finds it gone (deleted after the events were read) writes it again or leaves it, as `onRemoteDelete` says. The outcome is the target's health:
  `status`, `lastError`, `consecutiveFailures` and the usual 1, 2, 4 ... 15 minute back-off (`dueForAttempt`). Codes: the connection's own and `calendar_missing`, `unsupported`
  (the calendar cannot create), `unconfirmed`, `config_invalid`; a target that is switched off, whose connection is off or whose adapter
  does not run is answered (`disabled`, `no_connection`, `provider_unavailable`, `busy` for a second run at once) without touching its health.
  A target deleted during its run stops the run at the next step (a 404 as for any missing target) and nothing is saved for it. Logs carry codes only.
- **Scheduler** (`registerCalendarSync()` in `init()`): every minute it compares what hauswart knows with the links **without calling any
  calendar** (`hasPendingChanges`) and syncs the targets with a difference, which is how a change is written within a minute without
  instrumenting every service; every 15 minutes every target is synced regardless (that is how a deleted event is noticed). A saved target
  (event `calendarTargetChanged`), a saved connection and a completion (`completionRecorded`/`Revoked`, which move the next due date) kick a
  run after two seconds; targets that failed back off and are tried again as soon as the back-off is over (pending changes or not), and a run that was cut short by its size goes on at once, but a failed one does not. A request
  that finds its target busy (a manual sync) comes round again. Overlap guard, `unref`, injectable intervals and clock.
- **API**: `GET /calendar-targets`, `POST` (404 without a working connection or adapter, 400 on `remoteCalendarId` for a calendar that does not
  exist (`details.code` `calendar_not_found`) or cannot create (`calendar_unsupported`), 409 for a calendar that has a target, 502 `upstream_error` with `details.code`), `PATCH /{id}` (`config` is merged),
  `DELETE /{id}?removeRemote=true` (deletes the events carrying the marker first, linked or not, holding the target's run lock so no sync
  writes them again meanwhile: 409 `details.code: "busy"` while a run is going on, 400 on `removeRemote` for a calendar that cannot
  delete, 409 for a connection that is off, 502 with the target left as it was when nothing was touched yet; once events were deleted a
  failure or a too long list leaves the target **switched off** (502 with `details.deleted/remaining/disabled`), because the items still
  exist and the next sync would write the events again, and a second try goes on) and `POST /{id}/sync` (run now, a failed run is
  `ok: false` with the code, not an HTTP error). Scopes `read`/`write`; household targets additionally need the `admin` scope (403). The calendar
  picker `GET /integrations/{kind}/calendars` carries `capabilities` per calendar.
- **Home Assistant** (`integrations/homeassistant/calendar-provider.ts`, `calendar-events.ts`): a calendar is a `calendar.*` entity and
  `supported_features` says what it takes (create 1, delete 2, update 4); Home Assistant has **only a service for creating**
  (`calendar.create_event`, which does not return the id), so update and delete are the WebSocket commands `calendar/event/update|delete`
  (`haWsCall`), and the id of a new event is found again in `GET /api/calendars/<entity>` through the marker (the Local Calendar supports all
  three, Google create and delete, CalDAV create only; `alarms` is always false, Home Assistant keeps no reminders). Times are naive wall-clock
  strings in the zone of `GET /api/config` (`2026-06-20T09:00:00`; the household zone is converted by instant, and both ends need no common offset across
  the night the clocks change; in the night the clocks go back a time between 02:00 and 03:00 exists twice and Home Assistant reads it as the first
  one, so an event there can sit an hour off, and an event that starts in the first pass and ends in the second, which would end before it starts on the
  clock, gets its end as start plus its length so that Home Assistant accepts it), all-day items `start_date`/`end_date` with the exclusive end. The description is the item's text, a link when `appUrl`
  or `ORIGIN` is known, an empty line and the marker. Reads and `update` are retried twice (`retryTransient`, 300 and 600 ms) on `timeout`, `network`,
  `server`; `create` and `delete` never (a second event, or a delete of a deleted event). Home Assistant refuses a change or delete of an event it
  does not know with the same bare code `failed` as every other refusal (`not_found` is only the entity), so after such a refusal the adapter reads
  the span it listed last and answers `not_found` if the id is not in it (else the refusal stands). Fake: `fake-server.ts` models features, `create_event`,
  the commands and the zone; tests in `calendar-provider.test.ts` (calls, zones, failures, timeouts, malformed bodies) and `calendar-sync.test.ts` (the core runner against
  full, create-only and create-and-delete calendars). A core test must not import the adapter: `calendar-sync/testing.ts` has in-memory fake calendars.
- **Not built yet**: CalDAV/iCloud (the seam is meant for it), the pull direction (`pull`, `both`, `remote_wins`), `.ics` URL subscriptions as
  triggers, detecting edits made in the calendar. One hauswart per calendar: another install writing the same marker into a calendar would
  delete the events of the first.

## In the web app

- **Calendar sync in the web app**: the card `components/calendar-sync/targets-card.svelte` sits on `/settings/calendar` (tab "Kalender", below the
  iCal subscriptions; the Home Assistant card links to `#calendar-targets`). The load reads `GET /calendar-targets` and `GET /integrations`. Everybody
  sees the household's targets; only `canManage` ones get the switch, "Jetzt synchronisieren", edit and delete, and "add" needs a working connection of a
  system the person may add calendars of (`creatableProviders`: the household's connection means administrators). A target's state is
  `targetState` (paused, offline = its connection is not active, error, waiting, ok); codes go through `integrationErrorMessage(code, provider)`, which
  words the calendar codes too (`calendar_missing`, `unsupported`, `unconfirmed`, `config_invalid`, and the run-only `busy`, `disabled`, `no_connection`,
  `provider_unavailable`). A sync that ends `ok: false` is shown inline as a result, never as a crash; counts (`statLines`) are the target's `lastStats`, which
  a run that failed before it counted anything sets to null (it no longer keeps those of the run before it). A new target is looked at again every 3 s
  (ten times) so its first run shows. The dialog never shows or sends `direction` and `conflictPolicy`, lists the calendars of
  `GET /integrations/{provider}/calendars` with their capabilities (calendars that cannot create or already have a target are disabled, the 400 on
  `remoteCalendarId` (by its `details.code`, the two causes in their own words) and the 409 are worded on that field), sends only the fields that differ on PATCH (`updateBody`) and offers a reminder only when
  `capabilities.alarms`. Deleting offers "Einträge im Kalender ebenfalls entfernen" (`?removeRemote=true`) only with `capabilities.delete`; a 409 (connection
  off, or `busy`) or 502 (`details.code`, with counts and `disabled` once it began) is worded by `deleteFailure` and the target stays (then paused, and
  the list behind the dialog is reloaded to show it). `ConfirmDialog` takes optional content (`children`).
