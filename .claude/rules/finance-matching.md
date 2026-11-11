---
paths:
  - "src/lib/server/finance/**"
  - "src/lib/costs/{match,matches}*.ts"
  - "src/lib/server/integrations/kept/sync*.ts"
  - "src/routes/api/v1/finance/**"
  - "src/routes/*/costs/inbox/**"
---

# Matching with entries made by hand

A transaction of a finance app and an entry somebody typed are the same expense. The core is generic (`finance/links.ts`, `store.ts`, `events.ts`, the rule in pure
`lib/costs/match.ts`); the only adapter code is that `kept/sync.ts` does not auto-accept a `link` and counts `linkSuggestions`.

- **The rule** (`transactionMatchesEntry`): the same amount, sign included (a refund never matches an expense), and currency; booking dates at most `MATCH_DAYS` = 3
  days apart; the words of title and payee overlap by at least `MATCH_MIN_SIMILARITY` = 0.5 of the shorter side (overlap coefficient, so a short "Beispiel Markt" is found inside a
  long bank text). Words: lower case, `ä ö ü ß` spelled `ae oe ue ss`, other accents dropped, split at everything but letters and digits; single characters, numbers of up
  to four digits and a few fillers and legal forms (`AG`, `GmbH`, `und`) carry no weight. No typo tolerance, no stemming ("E-55" is "e" and "55": both dropped).
- **At offer time** (`recordSuggestion`, for every adapter): a _new_, _pending_ `cost` suggestion that matches an entry (`findMatchingEntry`) is recorded as a `link`
  suggestion (same connection and reference, payload `{entryId, transaction}`, the bill references kept) instead of a cost. The entry must be `manual` or
  `recurring`, **paid by the connection's owner**, not tied to a finance item (no `providerRef`, no `providerConnectionId`) and not the target of another pending link;
  with several the most similar text wins, then the nearer date, then the entry made first. A transaction recorded as already decided is never linked; one that has a cost or
  link suggestion already keeps it (a pending link takes the fresher transaction). Private like every suggestion (own rows only, 404 for others); the wire adds `entry`,
  the entry as it is now (null once deleted). It counts in `pendingFinanceSuggestions`.
- **When the entry comes second** (`linkWaitingOffer`, called by `createCost` inside the booking's transaction for an entry that has no finance origin: a `POST /costs`
  without `financeSuggestionId`, a recurring booking, a fuel fill): the payer's pending `cost` suggestions that match the entry (`transactionMatchesEntry`) are looked up
  and when **exactly one** does, it becomes a `link` in place (same id, connection, reference, bill references and place in the inbox; payload `{entryId, transaction}`).
  Never accepted by itself. Several fitting offers are ambiguous and change nothing; a transaction that has a link row already (turned down before, or accepted) is not
  linked again; a booking that rolls back leaves the offer as it was. Editing an entry does not look: a `PATCH` ties by `financeSuggestionId` only.
- **Accepting** (`POST /finance/suggestions/{id}/accept {}`, no overrides): the entry remembers the transaction (`providerConnectionId`, `providerRef`; `providerUrl`
  only when the entry was made by the connection's owner, since only its maker sees that; `providerLinkId` and `linkSyncedAt` null so the adapter writes the back-link
  and `financeLinksPending` fires), `source` stays `manual`, nothing new is booked, the answer's entity is the entry. 409 when the entry was deleted, got tied
  elsewhere or no longer has the amount and currency. The transaction is then never offered again (the accepted link answers a repeat).
- **Dismissing** a link means "not that entry", not "ignore the transaction": the link is dismissed and the transaction **comes back as a normal cost suggestion**,
  so it cannot drop out of the books, and a later read of it is not linked again. A deleted entry does the same for its pending links (`costEntryDeleted`, emitted by `deleteCost`
  inside its transaction); an entry that gets tied to another transaction releases the links to it. An accepted link stays accepted whatever happens to the entry.
- **Bills**: `suggestionsCoveringBill` also lists links that are pending or accepted, so a payment is still booked once: a pending bill offer, linked or not, gives way
  to the transaction that pays it, and a decided one makes that transaction arrive dismissed. An automatic category does not accept a link by itself: a wrong link would
  hide an expense.
- **Entry form side**: `GET /finance/matches?amountMinor=&currency=&date=` (scope `read`) answers the caller's own pending _cost_ suggestions with that signed amount and
  currency (default the household's) within 3 days, nearest date first, at most 20. `financeSuggestionId` on `POST /costs` and `PATCH /costs/{id}` ties the entry to
  one of them in the same transaction (`claimSuggestion`, `tieSuggestion`): 404 unless it is the caller's own, 400 on the field when it is not a cost or the amount or currency
  (the entry's after the change) differs, 409 when decided; PATCH answers 409 for an entry tied to another item and does nothing for the same suggestion again.
  Nothing is written when the entry is refused; the tie itself only takes a suggestion that is still pending (`tieSuggestion` updates `where status = 'pending'` and checks the row
  count), so one decided since the check is a 409 that rolls the entry back instead of being overwritten.
