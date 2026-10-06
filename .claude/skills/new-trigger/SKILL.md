---
name: new-trigger
description: Add a new recurrence/trigger type to hauswart's task engine (for example fixed interval, calendar rule, seasonal window, usage- or event-based) — pure engine module, table-driven tests, editor UI, Paraglide strings. Use when tasks need a new way to become due.
---

The engine lives in `src/lib/server/tasks/engine/` and is **pure**: `(rule, history, today) ->
next due`. It reads no clock, no database and no time zone; `today` is injected as a `YYYY-MM-DD`
string in the household time zone.

1. **Rule schema**: add the trigger's Zod schema to `src/lib/api/schemas/` as a member of the
   discriminated union keyed by `type`, so the API, the editor and the engine share one type.
2. **Engine module** `src/lib/server/tasks/engine/<trigger>.ts`: a function from the rule, the
   completion history and `today` to the next due date (or `null`). Date arithmetic happens on
   `YYYY-MM-DD` values, never through the server zone; handle month ends, leap days and
   year boundaries explicitly. Register it in the engine's dispatch.
3. **Table-driven tests** `<trigger>.test.ts`: a `it.each` table of
   `[description, rule, history, today, expected]`. Cover: never completed, completed early and
   late, overdue, month-end and Feb 29, year rollover, DST weekends, and every rule field's
   boundary values. No test reads the real clock.
4. **Persistence**: if the rule needs new columns, follow the `new-table` skill; otherwise the
   rule is stored as validated JSON in the existing column.
5. **Editor UI**: add the trigger to the task editor with shadcn-svelte inputs, a live preview of
   the next due dates computed through the API (not duplicated in the client), 360 px layout and
   dark mode.
6. **i18n**: every label, hint, unit and error message through Paraglide, keys added to
   `messages/de.json` and `messages/en.json` together.
7. Update the API contract (`new-endpoint` skill) if the rule shape changed, then run the
   `verify` skill.
