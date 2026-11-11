---
paths:
  - "src/lib/server/costs/{tags,budgets,recurrences,recurrence-scheduler}*.ts"
  - "src/lib/costs/{tags,budget,budgets,recurrence,recurrences,recurrence-controls,names}*.ts"
  - "src/lib/api/schemas/{cost-tags,cost-budgets,cost-recurrences}.ts"
  - "src/lib/server/api/handlers/{cost-tags,cost-budgets,cost-recurrences}.ts"
  - "src/routes/api/v1/{cost-tags,cost-budgets,cost-recurrences}/**"
  - "mcp/src/tools/{cost-tags,cost-budgets,cost-recurrences}.ts"
  - "src/routes/*/costs/{budgets,recurring}/**"
  - "src/routes/*/settings/cost-tags/**"
---

# Tags, budgets and recurring costs

All three are household data (no per-person scoping), reads need `read`, writes `costs:write`; they came with migration `0030`.

- **Tags** (`cost_tags`, `cost_entry_tags`; `costs/tags.ts`; `GET|POST /cost-tags`, `GET|PATCH|DELETE /cost-tags/{id}`): a label on entries, `name` (40,
  unique without regard to case, umlauts included, 409; compared by `lib/costs/names.ts` `nameKey` = NFC + `toLocaleLowerCase("de")` in the service and the tag form, because SQLite's `lower()` and so the unique index fold ASCII only) and `color` (a key of `COST_TAG_COLORS` the client maps, default `gray`), at most 200 (the list is not paged), the DTO
  carries `entryCount`. Entries take `tagIds` (create and PATCH; PATCH replaces, `[]` clears; each once, at most 10, an unknown id is a 400 on `tagIds`) and
  carry `tags` (`{id, name, color}`, by name). `tagId` narrows `GET /costs`, `GET /costs/summary` (every number, the settlement too) and the CSV; an
  unknown tag is a 404 there. The CSV's last column `tags` holds the names, by name, joined with `, `. Deleting a tag only untags (the links cascade). Accepting a
  cost suggestion (`tagIds`) and a recurring cost's template take tags too.
- **Budgets** (`cost_budgets`; `costs/budgets.ts`, pure `lib/costs/budget.ts`; `/cost-budgets`, `GET /costs/budgets/status?year=&month=`): for a book, a category or
  both (a CHECK; 400 on `bookId` when it names neither), `period` `month|year`, `amountMinor` > 0, `currency` = the household's when it was set (the status counts
  entries in the budget's own currency), `active`. One budget per book, category and period (409; three partial unique indexes, because a missing book or category is its
  own kind); deleting a book deletes its budgets. **Status**: for every _active_ budget the entries that count as an expense (refunds netted) of its scope in the
  month `year`/`month` or the whole year (`year` and `month` each default to today in the household zone), `spentMinor`, `entryCount`, `remainingMinor`, `percentUsed`
  (rounded down, 0 while the net is zero or negative) and `state` `ok|warning|exceeded` from 80 % / 100 % worked out on the amounts, not on the rounded percentage.
  **Not built**: a notification at 80 and 100 %. `generateNotifications` is task-centric, and a new kind needs entries in `NOTIFICATION_KINDS` and the title keys, four
  messages (notification and push, both languages), the Home Assistant renderer (`TITLES`, `LEVELS`) and the icon and tone maps of the notification list; the status
  carries what such a notice needs (a dedupe key of budget, period and threshold would be `budget:<id>:<period>:<80|100>`, household-wide rows).
- **Recurring costs** (`cost_recurrences`, `cost_entries.recurrence_id` + `recurrence_date`; `costs/recurrences.ts`, `recurrence-scheduler.ts`, the rule in pure
  `lib/costs/recurrence.ts`; `GET|POST /cost-recurrences`, `GET|PATCH|DELETE /cost-recurrences/{id}`, `POST /cost-recurrences/{id}/run-now`; at most 200): a template (the
  fields of `POST /costs` without a date; `sharesJson` / `participantIdsJson` for the split, `tagIdsJson`) and a rule: `frequency` `monthly|quarterly|yearly`, `interval`
  (1 to 12), `dayOfMonth` (1 to 31, default the day of `startDate`), `startDate`, optional `endDate` (included). Occurrences are counted from the start month, never from
  the previous occurrence, so a 31st gives 31 January, 28 February, 31 March and 29 February falls back to the 28th; the first is the first on or after `startDate`.
  Stored: `nextDate` (null once over), `lastOccurrenceDate`, `active`, `lastError` (`book_archived|failed`). The template is checked when saved as a booking would be
  (`checkCostTemplate`; 400 on the field, on `endDate` when no occurrence is left); the split is frozen **when an entry is booked**, so a changed ownership share applies to
  later entries only. **Booking** (`registerCostRecurrences()` in `init()`: 20 s after start, then every 5 minutes): `bookDueRecurrences` books for every active recurring
  cost every occurrence up to and including today in the household zone, oldest first (a server that was down books each occurrence it missed), at most `RECURRENCE_BOOKING_CAP` = 120 (one
  constant in the pure `lib/costs/recurrence.ts`, the server and the form's preview both read it) per recurring cost and run. One transaction per occurrence books the entry (source `recurring`, `recurrenceId`, `reviewNeeded` false, `createdBy` = whoever set it up) and moves
  `nextDate`; the unique `(recurrence_id, recurrence_date)` and a look-before keep it to one entry, and deleting the entry does not book it again. A failure (the book was
  archived: `book_archived`) is recorded on the recurring cost, keeps its place, does not hold the others up and is logged by code **once, when it begins or its reason
  changes** (the run tries again every five minutes; a stuck series must not fill the log). A tax class the template carries is booked as `unknown` while its book is not
  tax relevant (the template keeps it); a PATCH that moves the template into such a book resets it as for an entry, a different class there is a 400, and `splitMode: equal`
  without `participantIds` widens a narrowed template to everybody, and a new `category` brings the default of `countsAsExpense` along unless the template's value differs from the old category's default or the request names it, both as for an entry. Creating and PATCHing book what is
  due at once (a start date in the past books everything since, up to the cap). PATCH: the template applies to entries from now on; a changed rule continues after
  `lastOccurrenceDate`; `active: false` pauses, `active: true` resumes at the first occurrence on or after today (the paused time is skipped); the template is checked
  again only when the request touches it, so one in an archived book can still be paused; any change clears `lastError`. `run-now` books exactly the next due occurrence
  and answers `entry: null` when nothing is due or it is paused or over; a failure is recorded and thrown. Deleting keeps the entries (`recurrenceId` becomes null); a book
  with recurring costs cannot be deleted (409 `details.recurrenceCount`).
