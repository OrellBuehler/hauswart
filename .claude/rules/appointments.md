---
paths:
  - "src/lib/server/appointments/**"
  - "src/lib/appointments/**"
  - "src/lib/api/schemas/appointments*.ts"
  - "src/lib/server/api/handlers/appointments.ts"
  - "src/routes/api/v1/appointments/**"
  - "src/lib/components/appointments/**"
  - "src/routes/*/appointments/**"
  - "mcp/src/tools/appointments.ts"
---

# Appointments

- **Appointments** (`appointments`, migrations `0022` and, for the triggers, `0023`; `appointments/`, `lib/appointments/when.ts`):
  the household's "Termine" (a service visit, an inspection, a delivery), shared by everybody. `title` (200), plain-text
  `notes` (5000, no markup), `location` (300), `status` `planned|done|cancelled` (any status can be set from any other).
  **Two kinds, one CHECK**: timed (`allDay` false, `startsAt` < `endsAt`, UTC instants) or all-day (`allDay` true,
  `startDate` <= `endDate`, calendar dates in the household zone, the last day included, so it never moves with the zone); the
  fields of the other kind are null. At most 14 days (`whenProblem`, one function for the request schema, the form and the service, which
  re-checks the merged result; it has no time zone, so a timed one may be up to 14 days and an hour in real time,
  `MAX_TIMED_SPAN_MS`: 14 calendar days across the night the clocks go back are an hour longer, forward an hour shorter). On create `endsAt` defaults to an hour after the start and `endDate` to `startDate`. Optional
  `taskId` + `occurrenceKey` (the occurrence it is for: **pinned** when the appointment gets a task - on create, or in a PATCH that
  changes the task - as the key the task shows then, unless the request names one; the engine's placeholders `none` and `s:none`
  mean "no occurrence" and are never stored, so those stay null), `assetId` (defaults to the task's asset on create) and `contactId`, all
  `set null` when the target is deleted (the DTO shows no `occurrenceKey` without a task); `createdByUserId`. **For a later sync**: `id`
  is stable and `updatedAt` (from the injected clock) moves with every change, status included; a PATCH that changes nothing
  leaves it alone.
- **API**: `GET|POST /appointments` (scopes `read`/`write`; filters `from`/`to` = days in the household zone, both included, an
  appointment is listed when it overlaps one of them - a timed one counts on every day it touches, at midnight it ends it does
  not count on the next -, `assetId`, `taskId`, `contactId`, `status`; soonest first, an all-day one from midnight of its first
  day, then longer, title, id; offset cursor), `GET|PATCH|DELETE /appointments/{id}`, `POST /appointments/{id}/complete`.
  Instants are UTC ISO strings. **PATCH** changes what is given and refuses a result that breaks the rules (a start moved
  behind the end is a 400 on `endsAt`; nothing is shifted implicitly); `allDay` switches the kind and then needs the new start
  (`startDate` or `startsAt`); the fields of the other kind without `allDay` are a 400; a new `taskId` pins the occurrence that
  task shows now (the old key means nothing for it), `occurrenceKey: null` for the same task removes the pin; `status: done`
  records the status only. Create/PATCH 400s are field errors (`taskId`, `assetId`, `contactId`, `startsAt`, `endsAt`,
  `startDate`, `endDate`, `occurrenceKey`), 404 for a missing appointment.
- **Complete** (`complete.ts`): sets `done` and, with a task, completes the occurrence the appointment is for through
  `completeTask` with the idempotency key `appointment:<id>` as the caller (a session is `manual`, a token by its kind, like any
  completion; `note`, `completedAt` as for tasks). Always 200 with `{appointment, completion, task, replayed}`; a repeat answers with
  the first completion (`replayed`). **Which occurrence** (`mayComplete`, built so that it can neither count the work twice nor skip a
  cycle): a _pinned_ appointment completes only while the task still shows its pinned key (else somebody settled it, or it was missed,
  and what is shown is a later cycle); an _unpinned_ one (the task showed none, an explicit `occurrenceKey: null`, an older row) names
  nothing, so it completes the shown occurrence only if that is dated and fell due on or before the appointment's last day (`lastDay`
  in the household zone, an end at midnight belongs to the day before) - a later one belongs to a cycle the visit came before, an
  undated one has nothing to compare, a task that shows none has nothing to settle. Both also leave an occurrence the engine reports
  as handled (`state.reasons` has `completed`, `skipped` or `acknowledged`: a one-off, warranty or bill task keeps its key when it is
  done) - the engine's verdict, not a lookup of completions with that key, because a `min_per_period` task shows one key until its
  last completion of the period. `completion` is then null, as it is when the task is archived; the appointment is done either way.
  A cancelled appointment is a 409. A key is bound to its completion for good, so after the completion was undone and
  the appointment completed again the next one is `appointment:<id>:2` (and so on). **Undoing the task's completion does not
  reopen the appointment**, and reopening the appointment does not undo the completion: it took place either way.
- **On tasks and the dashboard**: every task DTO (list, `GET /tasks/{id}`, the answers of complete/skip/snooze) and every
  dashboard task carries `nextAppointment: {id, allDay, startsAt, startDate} | null`, the earliest _planned_ appointment of the
  task (a correlated subquery, `appointments/next.ts`; timed and all-day ones are ordered with a date as midnight UTC). One whose time has
  passed but that is still planned counts: the task stays what it is waiting for until somebody completes or cancels it. The
  due-date engine is not involved.
- **Owner type `appointment`**: comments (`/appointments/<id>`, trigger in `0023`; `commentCount` on the DTO), attachments
  (`removeOwnedAttachments` on delete), search (`search_fts` kind `appointment`: title, place and notes cut at a secret block, all
  statuses; `/appointments/<id>`). Document links are not offered.
- **iCal feed** (`calendar/feed.ts`, no switch of its own): every appointment that is not cancelled and ended less than 30 days
  ago (`APPOINTMENT_LOOKBACK_DAYS`, also the SQL lower bound on `ends_at` / `end_date`, so history is never loaded; planned ones that were never closed and done ones) as `appointment-<id>@hauswart`; scope `mine` =
  appointments without a task, of an unassigned task or of a task whose current assignee is the owner, `all` = every one.
  A timed one is `DTSTART:20260615T070000Z` / `DTEND` in UTC (no VTIMEZONE needed, no guessing on the nights the clocks change), TRANSP
  OPAQUE; an all-day one is `VALUE=DATE` with an exclusive `DTEND`, TRANSPARENT. `SUMMARY` the title, `LOCATION`, `DESCRIPTION` the
  asset and "Für: <task>", `URL` `/appointments/<id>`; never the notes. SEQUENCE/LAST-MODIFIED from `updatedAt`. The feed's alarm applies
  to planned ones: for a timed one as a trigger relative to DTSTART worked out on real instants (`alarmTime` in the household zone on
  the day `alarmDaysBefore` days before the start, e.g. `-PT37H` across the spring-forward Sunday), left out when it would ring after
  the start. Events sort by their date in the household zone.
- **MCP**: `list_appointments` (`from` defaults to today, for status planned to 30 days back, so a planned appointment that is over but was never
  closed shows up with `overdue: true`), `create_appointment` (times as `date` + `startTime`/`endTime` in the household zone, without
  `startTime` all-day), `update_appointment` (moving keeps the length, in real time, unless an end is given) and `complete_appointment`;
  task rows carry `appointment`.

## In the web app

- **Appointments in the web app**: `/appointments` (entry "Termine" in the overview group, behind "More" on phones; creating is a dialog, no
  `/new` route) shows `?view=upcoming|past` and `?status=planned,done,cancelled`; the load reads only `view` (it fetches `from`/`to` ranges,
  `viewRange`; the address for the sign-in redirect is read inside `untrack`, `page-load.test.ts` pins this), the status chips filter in the page from `page.url`
  without fetching again. "Over" is day-based and in the household zone (`isOver`: last day before
  today; a timed one that ends at midnight does not touch the next day). Upcoming = the last 30 days on, split by `sectionsFor` into "Noch offen"
  (planned and over: someone still has to close it, its task keeps waiting) and day groups by start day (a longer one that already started sits
  under today); past = the last 12 months, newest first, "older" loads the rest (merged by id with `appendById`: an appointment that spans the boundary is in both ranges). The detail page completes with `POST .../complete {}` and keeps
  what it answered for that page only: the task was completed, or why not (`completion: null`: archived, or the occurrence is settled); cancel
  has an undo toast, "reopen" says it does not undo the task's completion. `AppointmentFormDialog` creates, edits and prefills (`defaults`: task
  with its `occurrenceKey` (never the placeholders `none`/`s:none`), device, contact; another task sends none and the server pins what it shows); its times are wall-clock in the household zone (`zonedTimeToInstant`, never the browser's), an empty
  end sends none on create (the server's hour) and is made explicit on edit, a changed start or end sends both, and `buildUpdateBody` compares the
  wall-clock fields of each side with `draftFromAppointment` and sends a side that was not edited with its stored instant (`untouchedInstants`), so a
  start or end that falls in the repeated autumn hour (a wall-clock time cannot tell the two 02:30 apart) is not moved by editing the other side or the title. `LinkSelect` is a
  searchable combobox (task, device; contacts keep `ContactSelect`). `AppointmentsCard` (planned ones plus "create") sits on the task, device and
  contact pages; `AppointmentBadge` shows `nextAppointment` on task rows (`TaskRow` and `TaskRows` take `timeZone`; the badge is a link except
  inside `TaskRows`, whose row is one) and on the task page.
