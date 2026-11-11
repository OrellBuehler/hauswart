---
paths:
  - "src/lib/server/signals/**"
  - "src/lib/server/connections/**"
  - "src/lib/connections/**"
  - "src/lib/server/net/**"
  - "src/lib/hosts.ts"
  - "src/lib/server/integrations/http.ts"
  - "src/lib/server/integrations/homeassistant/**"
  - "src/lib/server/notifications/**"
  - "src/lib/server/rooms/**"
  - "src/lib/server/hints/**"
  - "src/lib/api/schemas/{integrations,notification-settings,rooms,hints}.ts"
  - "src/lib/server/api/handlers/{integrations,notificationSettings,rooms,hints}.ts"
  - "src/routes/api/v1/{integrations,ha,rooms,hints}/**"
  - "src/lib/components/connections/**"
  - "src/routes/*/settings/integrations/**"
  - "src/routes/*/settings/notifications/**"
  - "src/routes/*/rooms/**"
---

# Signals, integrations and delivery

- **Adapters only fetch; the core decides.** An adapter turns what it read into `SignalReading`s and
  calls `ingestSignals(ctx, readings, source)` (`signals/ingest.ts`): `upsertSignals` stores them (a
  reading without a value is skipped, so the last known value stays and the evaluator marks it stale
  after 24 h; numeric samples are written on change and every 6 h, pruned after a year), then
  auto-complete rules, hint reactions, re-evaluation of the tasks that read a changed signal, due
  reactions and `generateNotifications` run. Calendar dates go through `replaceExternalDates` and
  `afterCalendarSync`. The first sight of a signal is never a "change".
- **Watch list**: `watchedEntities(ctx)` (`signals/watch.ts`) = entity ids of active tasks' counter /
  state / calendar triggers (+ `estimateFrom`), auto-complete rules, preparation `leadValue`s and hint
  reactions, plus the calendar subscriptions (`haCalendarKey`). Saving a task, preparation or hint
  reaction emits `signalNeedsChanged` (`events.ts`) so an adapter reads soon, not at the next tick.
- **Auto-complete** (`autoComplete` on every recurring trigger, plus `autoCompleteOnReset` on counters):
  `{type: "counter_reset", entityId, minDrop}` (drop detected with the engine's `detectCounterReset`)
  or `{type: "state_change", entityId, to, from?}`. The task is completed by the system (source `ha`,
  no user, counter snapshot = new value) with `idempotencyKey` `auto:<taskId>:<entityId>:<changedAt>`,
  so replaying a change completes nothing twice. A completion of a counter task without an explicit
  `counterValue` snapshots the counter (`completeTask`), so the next period starts there.
- **Hint reactions**: a matching transition (`toState`, optional `fromState`) inserts a
  `pending_reactions` row (unique per hint and transition) due after `delayMinutes`; it is cancelled
  when the signal leaves `toState` first. `processDueReactions` (run by the core worker every 30 s and
  after each ingest) creates a `hint` notification (`notification_hint`: asset, title) per recipient
  (`all`, `assignee` of the linked task, or a list) and hands it to the channels. Restart-safe: rows only.
- **Worker** (`registerSignalWorker()`, started in `init()`): due reactions, `retryDeliveries`, and
  housekeeping (samples, unused calendar dates, delivery records older than 90 days).
- **Delivery** (`notifications/deliveries.ts`): `NotificationChannel.deliver(notification, recipient,
{actions, targets?})` returns one outcome per target (`sent|failed|skipped`). Before calling a channel
  the core applies the person's `notification_prefs` (push on/off, `pushStages`, quiet hours in the
  household zone; held-back deliveries are `deferred` rows and sent by `retryDeliveries` afterwards) and
  mints a one-time token (24 random bytes, base64url, sha256 stored, valid 7 days) for the task stages
  prep / due_soon / due / overdue, passed as `actions: [{id: token, kind: "complete"}]`. Every outcome
  is a `notification_deliveries` row (status, error code, attempts, token hash, occurrence key).
  Failed targets are retried twice (2, 4 min); stale ones (read, settled occurrence, older than a day)
  are dropped. In-app notifications never depend on any of this.
- **The "done" tap**: `POST /api/v1/ha/action {"action": "HW_DONE_<token>"}`, bearer token of kind `ha`
  with scope `ha:action` (another kind is 403). The token resolves to the notification's task
  occurrence and person; the completion is attributed to that person (source `notification`), not to
  the calling token. Unknown or malformed action 404; expired token, deleted/archived task, an occurrence
  settled otherwise, or an undone completion 410 `gone`. A repeated tap answers 200 with the first
  completion (`replayed: true`) - chosen over 410 so a retried request after a lost response is safe.
- **Per-person targets**: `GET/PUT /api/v1/me/notification-settings` (own only; replace-all of
  preferences and up to 10 targets; `ha_notify` target = notify service name `^[a-z0-9_]+$`).
- **Connections** (`connections` table, `connections/connections.ts`): one household row per kind
  (`userId` null; partial unique index) or one per person (`INTEGRATION_LEVELS` in `enums.ts`).
  `GET /integrations` (never the token; the address of a household connection only for administrators),
  `PUT|DELETE /integrations/{kind}` and `POST .../test` (household kinds need an administrator; a
  changed address needs the token again), pickers `GET /integrations/{kind}/{entities,notify-services,
calendars,devices,areas}` (any member; 404 not connected, 502 `upstream_error` with `details.code`). An
  adapter registers `registerIntegration({kind, validate?, checkReferences?, test, describe, operations})`; it throws
  `IntegrationError(code, message)`. Health (`status`, `lastError` code, `consecutiveFailures`) is
  recorded by the adapter; `dueForAttempt`/`backoffMs` give the 1, 2, 4 ... 15 minute backoff.
- **Where a connection may point** (`connections.ts` `vetConnectionTarget`, `net/host-policy.ts`, `integrations/http.ts`
  `guardHost`): the server fetches what a person enters, and Paperless and Kept are per person, so this is an SSRF
  surface. The household setting `integrationHostAllowlist` (hosts as `host` or `host:port`, normalised by
  `normalizeHostEntry`: lower case, IDN as punycode; exact match, no wildcards; an entry without a port allows every
  port; max 50; `PATCH /household`, shown in `GET /household` only with the `admin` scope) applies when a **non-admin
  saves a user-level connection**: the host must be listed, else 403 `forbidden` with a message that names the host.
  Administrators may save any host and saving never adds to the list (keep it explicit); an empty list means members
  cannot connect. For everybody: link-local (169.254.0.0/16, fe80::/10), the metadata endpoints (100.100.100.200,
  fd00:ec2::254, `metadata.google.internal`) and IPv4-mapped / NAT64 spellings of them are refused after name resolution
  (every answered address is checked) at save time (400 field error on `baseUrl`) and before **every** request in
  `fetchOnce` and the Home Assistant WebSocket (`blocked_host`, shown as the connection's `lastError`). Loopback
  (127.0.0.0/8, ::1, 0.0.0.0) only for administrators and household-wide connections: `ResolvedConnection.allowLoopback`
  is computed from the owner's current role on every `resolveConnection`, so a demotion applies at once (403 at save,
  `blocked_host` at request time). A name that does not resolve is left to the request. DNS rebinding between the check
  and `fetch` is not closed (no pinning of the connect address); that is why the check repeats per request and a
  connection's responses only ever go to its owner. Tests run with `setLenientHostPolicy(true)` (vitest setup: loopback
  allowed, names not resolved, metadata still blocked); tests of the policy switch it off and stub `setHostResolver`.
  Members saving in tests need `allowIntegrationHosts(db, host)` (`$lib/testing/integrations`).
- **Home Assistant adapter** (`registerHomeAssistant()` in `init()`): scheduler (overlap guard, unref,
  injectable intervals) reads the watched entities every 60 s and the calendars (next 60 days, per
  subscription key, household zone) every 6 h and at once for a new calendar; saving a connection reads
  immediately. `ha_notify` channel: `notify/<target>` with title and text rendered in the recipient's
  language, a link built from `config.appUrl` (else `ORIGIN`, else the bare path), tag `hw-task-<id>`,
  button "Erledigt"/"Done" = `HW_DONE_<token>`. Entity ids that are not valid are never requested; an
  entity HA does not know is only counted. Assets can carry `externalSource`/`externalRef`; the devices
  picker lists registry devices matching no asset (reference, name, or model with overlapping name).
  Entity names in code and tests stay synthetic (`sensor.example_*`). Events hauswart wrote into a calendar itself
  (they carry the marker of "Calendar sync") are left out when a calendar is read for `ha_calendar` dates.
- **Areas as rooms** (`rooms/areas.ts`, `connections/areas.ts` client-safe): the adapter operation `areas` answers
  `{id, name, floor}` (floor names from `config/floor_registry/list`, which an older Home Assistant refuses: then no
  floors, logged by code; ordered by floor level, then name) and knows nothing about rooms; the core says "areas of
  a connected system" and stores the id in `rooms.haAreaId` (a name kept for the column, no provider is recorded).
  `GET /integrations/{kind}/areas` adds `roomId` (the room that stores that id, compared without case and punctuation).
  `POST /rooms/import-areas {kind, areaIds}` (scope `write`) re-reads the areas, so names come from the system and
  never from the caller, then in one transaction, per area in the order given: a room that stores the id is
  `unchanged`; else an unlinked room of the same name (case, accents and `ue`/`ü` spellings ignored) takes the id
  (`linked`; a stored id that no listed area has counts as unlinked, one that belongs to another listed area does not);
  else a room is `created` (name cut to 100 characters, sort order at the end, slug as for any room); an id the system
  does not list is `not_found`. Repeating changes nothing, and a later rename in Home Assistant never touches the room.
  There is no unique index on `haAreaId`: the room form's area picker (`components/connections/area-picker.svelte`,
  a plain field without a usable connection) disables areas another room already stores. `matchAreaToRoom` is shared by
  the service and the import dialog (`area-import-dialog.svelte`, "Aus Home Assistant übernehmen" on the rooms page)
  so the preview and the result agree. Device suggestions carry `areaId` so `roomForArea` matches by id first.
