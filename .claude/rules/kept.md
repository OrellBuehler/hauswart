---
paths:
  - "src/lib/server/integrations/kept/**"
---

# Kept adapter (`integrations/kept/`)

- **Connection** per person (`kept`, `INTEGRATION_LEVELS` user): `PUT /integrations/kept` with `config`
  `{categoryMap: {keptCategoryId: costCategory}, purchaseCategoryIds, autoAcceptCategoryIds (subset of the
map), billTasks, billCreditorFilter (case-insensitive exact creditor names; applies to bill tasks and to paid-bill cost offers), billCostCategory, assignBillTasksTo:
"owner", syncFrom}`; unknown keys are dropped. Everything is opt-in: no category, nothing read. `test` calls
  `me()` and reports `info.missingScopes` (of `transactions:read, bills:read, links:write, categories:read`)
  and `info.backLinks` (false without `ORIGIN`: no back-links can be written then; the card says so).
- **Sync** (`syncConnection`, scheduler every 30 min, backoff 1, 2, 4 ... 15 min via the connection's
  health, immediately when a connection is saved, overlap guard per connection and in the scheduler; each
  part runs on its own and the first failure becomes the connection's `lastError` code):
  - transactions of every mapped or purchase category since the cursor (`finance_sync_state`, per scope:
    a different category set, `syncFrom` or choice of books starts over; first run from `syncFrom` or 1 January) become `cost`
    suggestions via `transactionToCostSeed` (or `link` suggestions to entries made by hand, counted as `linkSuggestions`, never booked at once), or cost entries at once for automatic categories; outgoing payments
    from purchase categories also `asset` suggestions. A failed item keeps the cursor where it was.
  - with `billTasks`: open and overdue bills (creditor filter) become bill tasks; tasks of bills that left the
    list are read individually (paid/cancelled/open again, 404 = archived).
  - with `billCostCategory`: paid invoices become `finance_bill` cost suggestions - **unless a transaction
    covers the bill**: a pending bill offer is withdrawn when its transaction arrives, a decided one (accepted or
    dismissed) makes the transaction arrive as dismissed, so a payment is booked once.
  - back-links: a booked entry gets `upsertLink` on its transaction or bill (`source: hauswart`, label title
    (+ asset), url `ORIGIN/costs/<id>`; skipped without `ORIGIN`), a deleted one gets `deleteLink`; a failing
    call is logged by code and retried next sync, an item Kept does not know (404, 409, 400) is given up on. A
    links-only round also runs shortly after a cost from Kept is booked, edited or deleted.
- **Books**: `config.categoryBookMap` `{keptCategoryId: bookId}` names the cost book of a mapped category (an entry
  for a category that is not mapped is dropped when the settings are saved) and `config.defaultBookId` the book of a mapped
  category without one and of paid invoices (`billCostCategory`; they have no Kept category). `bookFor` (sync.ts) takes
  the category's book, else the default, else none; a book that is deleted or archived counts as none and the next choice
  is tried, none meaning the household's default book. The id goes into the suggestion's payload (`bookId`, left out when
  none) and, in an automatic category, to `acceptSuggestion` as the body's `bookId` (the adapter passes it, the core
  knows no Kept). The cursors of the transactions and of the paid invoices carry a digest of the books the settings
  name (`booksScope`: the category map and the default book for transactions, the default book alone for invoices), so
  a changed choice reads everything since `syncFrom` again and the offers still waiting take the new `bookId` (a
  decided one never changes: `recordSuggestion` rewrites pending ones only). Book ids are checked when settings are saved: the adapter's `checkReferences` (a generic hook of
  `IntegrationAdapter`, run by `saveConnection` with the database after `validate`, and only when the request sends
  `config`, so a save that leaves the stored settings alone never trips over a book deleted since) throws an
  `IntegrationError` with `field: "config"`, which becomes a 400 on `config` naming the book. A book that does not exist
  is refused, an archived one is allowed (it counts as none when used, the form warns), and the choice for a category that
  is not mapped is dropped before the check. The web settings form has a book select under each mapped category (empty = the connection's default) and one for `defaultBookId` (empty = the household's default book); an archived choice shows a warning, a refused one `integration_kept_book_gone_error`; the accept dialog preselects the book offered with a suggestion.
- Logs carry codes only (`kept.transaction_failed {code}`), never titles, amounts, creditors or tokens.
