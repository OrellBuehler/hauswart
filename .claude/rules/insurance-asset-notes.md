---
paths:
  - "src/lib/server/insurance/**"
  - "src/lib/insurance/**"
  - "src/lib/server/asset-notes/**"
  - "src/lib/asset-notes/**"
  - "src/lib/api/schemas/{insurance,asset-notes}.ts"
  - "src/lib/server/api/handlers/{insurance,assetNotes}.ts"
  - "src/routes/api/v1/{insurance-policies,asset-notes}/**"
  - "src/lib/components/{insurance,asset-notes}/**"
  - "src/routes/*/insurance/**"
  - "mcp/src/tools/{insurance,notes}.ts"
---

# Insurance policies and asset notes

- **Insurance policies** (`insurance_policies`, `insurance_policy_assets`, migrations `0017` and, for the
  triggers, `0018`; `insurance/policies.ts`): generic and shared by the household (`type`: car liability / partial /
  full casco, contents, personal liability, building, legal, travel, health, life, other). `title`, the insurer as
  a contact (`insurerContactId`, set null when the contact is deleted; the DTO has `insurerName`), `policyNumber`,
  `premiumMinor` per `premiumPeriod` (`monthly|quarterly|semiannual|annual`) + `currency` (the household's when
  omitted), `deductibleMinor` (same currency), `startDate`, `endDate` = the **last day of cover** of the current term
  (what an insurer prints as "expires 1 January" is 31 December here), `renewal` (`auto|fixed`),
  `cancellationNoticeMonths`, `assistancePhone`, `showOnEmergency`, `notes`, `archivedAt`. What a policy covers is
  a many-to-many list (`assetIds`, replaced as a whole by PATCH); deleting an asset or the insurer's contact never
  deletes the policy.
- **Derived, never stored** (`lib/insurance/policy.ts`, pure, client-safe, table-tested): `annualPremiumMinor` =
  premium times the periods in a year (exact integer) and `cancellationDeadline` = `endDate` minus the notice months,
  clamped to the end of a shorter month (31 May and 3 months = 28 February); an end date that is the last day of its
  month gives the last day of the target month (30 June and 3 months = 31 March), only for `renewal: auto` with an
  end date and a notice period, else null. It is a function of three stored fields, so storing it could only let it
  disagree with them; the web form can show it live with the same function. It does not roll by itself: after an
  automatic renewal somebody moves `endDate` to the end of the next term and the deadline and reminder follow.
- **API**: `GET|POST /insurance-policies` (filters `assetId`, `type`, `q` over title, policy number and insurer's
  name; only active ones unless `archived=true`, which lists the archived ones; sorted by deadline, none last, then
  title), `GET|PATCH|DELETE /insurance-policies/{id}` (`archived` archives and restores), `GET
/assets/{id}/insurance-policies` (for the asset page; 404 for an unknown asset). The DTO carries the covered
  assets (id, name, kind), `reminderTaskId` and `commentCount`.
- **Reminder task** (`insurance/reminder.ts`, `syncReminder` after every create and update; the defect pattern): a
  `one_off` task with `externalSource: "insurance"`, `externalRef` = the policy id, category `payment`, text in the base
  language, `externalUrl` `/insurance/<id>`, **due on the deadline itself** (so every date shown anywhere is the real
  one), `dueSoonDays` 14 and a preparation 30 days ahead. It exists while the policy is active and the deadline is
  today or later; it is archived when the policy is archived or the deadline goes away or moves into the past (an
  overdue reminder that nobody finished stays, whatever else of the policy is edited, until the dates change) and the
  same task comes back. A one-off task
  stays done once completed, so when the deadline moves and the reminder was completed or skipped, that task is kept
  archived with its history under `externalRef` `<policyId>@<taskId>` and a new one is created for the new deadline;
  an unfinished one moves in place. Deleting the policy deletes all of them.
- **Owner type `insurance_policy`**: attachments (policy documents), document links (new roles `policy` and
  `registration` = vehicle registration; trigger in `0018`), comments (`/insurance/<id>`, trigger in `0018`) and search
  (`search_fts` kind `insurance_policy`: title, policy number and notes cut at a secret block, never the assistance
  phone; archived policies are dropped).
- **Emergency**: not archived policies with `showOnEmergency` are in `GET /emergency` (`insurance`: insurer name and
  phone, policy number, assistance phone) and in a section of the sheet (left out when there are none). Guest links
  never show policies: no guest section fits, the guest view reads none.
- **Asset notes** (`asset_notes`, migration `0019`; `asset-notes/`): small issues to mention at the next
  appointment ("brakes squeak"). `body` (at most 2000 characters), `status` `open|resolved`, `resolvedAt`,
  `resolvedBy`, `serviceLogId` (the entry that addressed it, set null with the entry), `defectId` (set null with the
  defect), `createdBy`. `GET|POST /assets/{id}/notes` (`status` `open` (default), `resolved` or `all`, newest first),
  `PATCH|DELETE /asset-notes/{id}`: resolving records who and when, reopening clears both and the service log link,
  asking for the status a note already has changes nothing. The owner type `asset_note` takes photos (they go with the
  note, and with the asset); a note takes no document links.
- **To a defect** (`POST /asset-notes/{id}/to-defect`, 201 `{note, defect}`): in one transaction a defect on the asset
  (title = the first line cut to 200 characters, description = the text, discovered the day the note was written,
  medium, **no deadline and so no reminder task**: a note is not a claim against the builder, so the household's
  handover deadline is not assumed) and the note resolved with `defectId`. 409 for a note that already is a defect;
  once that defect is deleted the note can be converted again.
- **Resolving through the service log** (`asset-notes/resolve.ts`): `resolvedNoteIds` on service log create and
  update and inside `serviceLog` of `POST /tasks/{id}/complete`. The notes must exist and belong to the entry's asset
  (400 on `resolvedNoteIds`, in a completion on `serviceLog`, before anything is written); open ones become resolved
  with the entry (`resolvedBy` = whoever wrote it), resolved ones stay as they are, so a retry changes nothing; an
  update only adds. The notes and the entry are written in one transaction. **Undoing** the completion that wrote the
  entry reopens its notes (listener on `completionRevoked`, `asset-notes/events.ts`; the entry stays in the log) and
  **deleting** an entry reopens them too. Neither reopens a note that was turned into a defect in the meantime
  (`defectId` set; `reopenNotesOf` skips it): the defect carries the issue on, so the note would be listed twice.
  Once that defect is deleted the note counts as an ordinary resolved one again.
- **`openNoteCount`** is on every task and every dashboard task: the open notes of the task's asset (a correlated
  subquery, 0 without an asset), so the due service task can say "3 Anliegen". The complete endpoint reads the task
  again after writing the entry, so the count it returns is current.
- **Notices**: the due soon and due notices of a task whose asset has open notes are
  `notification_due_soon_notes` / `notification_due_notes` (the usual params plus `notes`, counted when the notice is
  written; the dedupe key is the same, so a stage is still announced once). Prep and overdue notices are unchanged.

## In the web app

- **Insurance and asset notes in the web app**: `/insurance` (list with a yearly total, detail, form; the form shows the
  cancellation deadline live from `lib/insurance/policy.ts`, request mapping in `lib/insurance/form.ts`) sits in the finance group
  of the sidebar, so behind "More" on phones. Asset notes live in the card with the anchor `#notes` (`components/asset-notes/`);
  `NoteChoices` is the picker for the completion and service log dialogs and `OpenNotesBadge` the count on task rows and the task
  page. After `bun run check` or `bun run i18n` restart a running `bun dev`: regenerated route nodes and message modules leave the
  dev client with a stale manifest.
