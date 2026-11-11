---
paths:
  - "src/lib/server/events.ts"
  - "src/lib/server/domain-events.ts"
  - "src/lib/server/{parts,defects,comments,service-log,contacts,warranties}/**"
  - "src/lib/api/schemas/{parts,defects,comments,service-log}.ts"
  - "src/routes/api/v1/{parts,defects,comments,service-log}/**"
---

# Parts, defects, comments and domain events

- **Events keep domains apart.** `completeTask`/`undoCompletion` emit `completionRecorded` /
  `completionRevoked` (`events.ts`) inside the same SQLite transaction as the change; the parts
  service subscribes (`parts/events.ts`) and the tasks service knows nothing about parts. A
  listener that throws rolls the completion back. Register new reactions in `domain-events.ts`.
- **Stock** only changes through movements (`part_movements`, with `completionId` for task usage).
  Completing a `done` task takes `task_parts.qty` out (never below zero, the movement records the
  actual amount); undo books the net back as a `correction`. Manual `used` needs a negative delta,
  `bought` a positive one and ends a pending order. `orderNow` = engine `orderNowItems` over
  active tasks with linked parts, counting what is on order as stock. An `order_part` preparation is
  `in_stock_skip` while the part's stock covers its qty.
- **Defects**: transitions in `DEFECT_TRANSITIONS` (active statuses reach any other; fixed/rejected
  only reopen); every status change writes a `defect_events` row; remarks are generic comments and
  `GET /defects/{id}/timeline` merges both. The deadline defaults to household handover date +
  `defectDeadlineMonths` (`deadlineSource` handover) and is recomputed when the household changes.
  A deadline keeps one `one_off` reminder task (`externalSource: "defect"`, category `defect`, system
  text in the base language) that is archived when the defect is fixed/rejected or has no deadline. A note on an
  asset can become a defect (`POST /asset-notes/{id}/to-defect`, see "Insurance policies and asset notes").
- **Comments** (`comments` table, `entityType` + `entityId`): a kind of entity is commentable once
  it is in `comments/registry.ts` (`exists`, `title`, `url`, optional `audience`; the urls are the UI
  routes, `/docs/<slug>` for pages). Deleting an entity removes its comments through
  `AFTER DELETE` triggers (migrations `0004` and `0007` for pages): add one per new commentable table. Delete is soft
  (empty body, `deleted: true`), edit is author-only (403 otherwise), delete is author or admin. A new
  comment notifies the other involved members (`notification_comment`). Tasks, assets, defects, hints,
  service log entries, pages, cost entries, insurance policies and appointments carry `commentCount`; cost entries (trigger in
  migration `0013`), insurance policies (`/insurance/<id>`, trigger in `0018`) and appointments (`/appointments/<id>`, trigger in `0023`) are commentable too.
- **Hint reactions** (`signalReactionSchema`, type `signal_change`) are stored with the hint
  (`GET /hints?reactive=true`) and executed by `signals/reactions.ts`, see `signals-integrations.md`.
