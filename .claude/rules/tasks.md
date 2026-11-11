---
paths:
  - "src/lib/tasks/**"
  - "src/lib/server/tasks/**"
  - "src/lib/server/notifications/**"
  - "src/lib/server/seed/**"
  - "src/lib/api/schemas/{tasks,notifications,seed,dashboard}.ts"
  - "src/lib/server/api/handlers/{tasks,preparations,notifications,dashboard}.ts"
  - "src/routes/api/v1/{tasks,completions,notifications,dashboard,stats}/**"
  - "src/lib/components/tasks/**"
  - "seed/**"
  - "scripts/seed.ts"
---

# Tasks, evaluation and notifications

- **The engine decides, the database remembers.** `task_state` holds the engine's last verdict per
  task (status, due date, occurrence key, estimate, current assignee). It is a cache: `evaluateAll`
  rebuilds it from `tasks` and the non-revoked `task_completions`. A task is re-evaluated when it is
  created, edited, completed, skipped, undone or snoozed (synchronously, before the response) and
  every five minutes by the scheduler (`registerEvaluator()` in the startup hook; it also runs
  `generateNotifications`). Lists, the dashboard and notifications read the cache.
- **Live readings come from the database.** The evaluator reads `signals`, `signal_samples` and
  `external_dates` (`tasks/signals.ts`, `loadSignalsFromDb`); `setSignalProvider()` replaces that
  (tests). Without readings, signal-based triggers report `unknown`. A failing provider is logged by
  name and treated as "no signals". The evaluator also keeps `task_state.counterBaseline` (the first
  fresh reading of a counter task, until a completion snapshots one) and `activeSince` (since when a
  state condition holds; forgotten when it stops holding). A reading with source `manual` (typed in
  by a person, e.g. an odometer) never goes stale (`isSignalFresh`), is never pruned (neither the
  signal nor its samples), its samples are loaded 400 days back and its estimates look back up to a
  year (`SPARSE_WINDOWS_DAYS`); every other reading is stale after 24 h as before.
- **`counter_delta.orEvery`** `{every, unit}` makes a counter task also fall due by time: when the
  counter threshold is reached or the interval since the last completion (the task's creation, the
  `startedOn` the evaluator passes, when there is none) has passed, whichever comes first. While the
  counter is short of its threshold the time limit sets the status and the date shown is the earlier
  of the limit and the counter estimate: `dueKind` `exact` for the limit, `estimated` while the
  estimate comes first. Once the counter has crossed its threshold the status follows the counter:
  `dueKind` `condition`, `dueDate` the day the evaluator first saw it there, `due` from then and
  `overdue` after the grace days counted from that day - unless the time limit had already fallen on
  an earlier day, which then stays the date and sets the status (`exact`). In the `estimated` case
  `dueDate` **stays the hard time limit** and
  `estimate` carries the earlier guess, so the status, the "due soon" notification and the iCal feed
  keep the limit; whoever shows a date takes `shownDate` / `shownDateIsEstimate`
  (`lib/tasks/engine/shown.ts`: the estimate for kind `estimated`, else the due date) instead of
  `dueDate ?? estimate`. Lists, the dashboard and preparations use the estimate, the detail page
  shows both ("~ date" and "at the latest ..."). A missing, stale or baseline-less counter no longer makes the task
  `unknown`: the time half decides, the reason (`signal_missing`, `signal_stale`, `baseline_missing`)
  is still reported. The occurrence key stays `c:<last completion id>`. `createTask` stores
  `createdAt` from the injected clock.
- **A completion settles the occurrence the task shows** (`occurrenceKey` defaults to the cached
  one; `dueDateAtCompletion` is stored with it). Sources: a session is `manual` (or `qr` /
  `notification` when it says so); a token is attributed by its kind (`mcp`, `ha`, otherwise
  `api`) and its own `source` field is ignored. `idempotencyKey` makes retries return the first
  completion (200 instead of 201). Undo is a soft revoke within 7 days of recording, by any member.
- **Rotation** is computed in the evaluator (`nextAssignee`); the "fair" strategy weighs minutes of
  work (task effort, 15 if unset) of the last 90 days.
- **Notifications** are rows per person with a Paraglide `titleKey` plus `params` (rendered by the
  reader). `dedupeKey` = `<taskId>:<occurrence>:<stage>[:n]:<userId>`; stages are a preparation
  becoming relevant, due soon, due, overdue (when it becomes overdue, then weekly, four in all) and
  one digest per person per day after the household's digest time (skipped when empty). Snoozed and
  archived tasks are silent. `userId` null means household-wide (shared read state). Outward
  delivery is a `NotificationChannel` registered with `registerNotificationChannel`; the in-app
  list needs none. A task whose asset has open notes announces due soon and due with the `*_notes` variants
  of the message (see "Insurance policies and asset notes").
- **Seed files** (`seedSchema`, `seed/*.json`; real data in gitignored `seed/local/`) are imported
  by `scripts/seed.ts` through the REST API and matched by `key`, so repeating it changes nothing:
  rooms and assets by slug, tasks by `externalSource: "seed"` + `externalRef`, preparations by title.
  Existing entries are left alone unless `--update`. Changing the household needs the admin scope.
  An asset of kind `vehicle` may carry a `vehicle` block (the body of `PUT /assets/{id}/vehicle`):
  saved when the vehicle has no saved details yet, overwritten (and what the file leaves out cleared)
  only with `--update`; the block cannot carry `costBookId` (a file knows no book ids) and an update keeps the book a
  person chose. Tire sets and fuel logs are not seeded: a set has no key to find it again by, and a fill books
  a cost entry (`costs:write`).
