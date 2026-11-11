---
paths:
  - "src/lib/server/vehicles/**"
  - "src/lib/vehicles/**"
  - "src/lib/api/schemas/{vehicles,vehicle-stats,fuel-logs,tire-sets}.ts"
  - "src/lib/server/api/handlers/{vehicles,fuelLogs,tireSets}.ts"
  - "src/routes/api/v1/{fuel-logs,tire-sets,odometer-readings}/**"
  - "src/routes/api/v1/assets/**"
  - "src/lib/components/vehicles/**"
  - "mcp/src/tools/{vehicles,vehicle-stats,fuel,tires}.ts"
---

# Vehicles

- **A vehicle is an asset of kind `vehicle`** (no room; `GET /assets?kind=vehicle`, and `q` also matches
  the plate, both sides compared through `plateKey`: case, spaces, dots and dashes do not matter, so `zh 000.000` finds
  `ZH 000000`; `vehiclesWithPlateLike` in `vehicles/summary.ts`, in code and not in SQL, which could only strip the
  characters it was told about). `vehicle_details` (1:1, created by the first save) holds plate, VIN, Stammnummer
  (`registrationNumber`), `firstRegistration`, `fuelType`, tire sizes, `location`, `odometerUnit`
  (`km|mi`), notes and `costBookId` (the cost book its fuel fills go to, see "Fuel log"; `ON DELETE SET NULL`, migration
  `0027`). `GET|PUT /assets/{id}/vehicle`: PUT replaces (a field left out is cleared; the
  unit relabels the readings, it does not convert them), 400 for an asset of another kind, 404 for a
  missing one; GET answers empty details for a vehicle never saved and 404 for another kind. The asset
  DTO carries `vehicle: {plate, odometer: {value, date, unit} | null}` for vehicles only. The plate is
  indexed for search (see "Search"); deleting the asset removes the odometer signal as well. A vehicle cannot
  change its kind away (`PATCH /assets/{id}`) while it holds saved details (a row that says something; one saved
  with nothing in it does not count and goes with the change), odometer readings or tire sets: 400 field error on
  `kind` naming what is left (`vehicles/kind.ts`, `storedVehicleData`). Fuel log entries need no check of their own,
  each is also an odometer reading.
- **One rule for what only a vehicle has.** Everything under `/assets/{id}` that belongs to vehicles (`/vehicle`,
  `/vehicle/stats`, `/odometer`, `/fuel-logs`, `/tire-sets`, `/tire-sets/{setId}/mount`) treats an asset of another kind
  alike: a **read** is a 404 `not_found` (there is nothing of the sort to show, as for a missing asset), a **write** is a
  400 `invalid_request` (well formed, but that asset cannot have it); a missing asset is a 404 for both. It lives in
  `vehicles/kind.ts` (`assertVehicleForRead` / `assertVehicleForWrite`) and every registry description repeats it, so it
  reaches OpenAPI; `src/routes/api/v1/assets/vehicle-only.test.ts` runs the table. Endpoints addressed by the id of a
  tire set, fuel log entry or odometer reading (`/tire-sets/{id}`, `/tread`, `/fuel-logs/{id}`, `/odometer-readings/{id}`)
  look at no asset kind: those records can only exist for vehicles (see the kind rule above).
- **Odometer readings** (`odometer_readings`, never pruned): `POST /assets/{id}/odometer` (`date`
  defaults to today and is never in the future), `GET` newest first (keyset), `DELETE
/odometer-readings/{id}` (a reading written for a completion, service log entry, fuel log entry or tire change belongs to
  that record and is a 409 `conflict` naming the owner, `details.source`/`sourceId`; one whose record is gone, say a deleted
  task's completion, is free again). A value lower than the reading before it (the newest on or before the date)
  is a 400 on `value`, and so is a value higher than the reading after it (the first one on a later
  date; the same rule for every writer, completions, service log, fuel log and tire changes included), unless
  `force: true` (replaced instrument cluster). That 400 carries a structured reason in `details` besides the English field
  error (whose text is no contract): `code` `lower_than_previous` / `higher_than_next` (`ODOMETER_REFUSAL_CODES`), `field`
  (the request field it is reported on: `value`, `odometer` or `counterValue`) and `reading` `{value, date}`, the
  neighbouring reading in the way (`odometerRefusalDetailsSchema`, built by `outOfOrder` in `vehicles/odometer.ts`); every
  other 400 of a reading (future date, negative value, no vehicle) has no `code`, since `force` would not help.
  `recordOdometer(ctx, {assetId, date, value, source, sourceId?, note?,
createdBy?, force?})` is what other features call when they learn the odometer on the side (fuel log,
  tire change); `source` is `manual|completion|service_log|fuel_log|tire_change` and one
  `(source, sourceId)` has one reading, so saving the record again updates it. `writeOdometer` is its
  synchronous half (runs in the caller's transaction, `fields` names the request field a problem is
  reported on); `settleOdometer` re-evaluates the tasks that read the odometer and announces what became
  due (`recordOdometer` runs both).
- **The engine reads a signal, the readings stay the truth.** `syncOdometerSignal` rebuilds, after every
  insert, update and delete, the signal `odometer:<asset id>` (`odometerSignalKey`; source `manual`, so
  it never goes stale and is never pruned; unit of the vehicle) from the newest reading and one sample
  per reading (at noon of its date in the household zone, or the moment it was entered when earlier).
  A task counts on it with `counter_delta` and `entityId: "odometer:<asset id>"` (optionally `orEvery`);
  the Home Assistant adapter never asks for such a key (not an entity id). A change of the newest value
  goes through `settleSignalChanges` (auto-complete, hint reactions, re-evaluation, notifications, as for
  an adapter's readings). Readings come in now and then, so the estimate (`estimateCrossing`, windows of 28, 90 and
  365 days for manual signals) counts its days from the day of the newest sample, not from today: without a new
  reading it stays where it is, and once that day has passed it says tomorrow with low confidence. A counter task remembers the first value it saw (`task_state.counterBaseline`) until a
  completion snapshots one; the same sync forgets that value when no reading has it any more (the typo that was deleted
  or corrected), so the task starts again from what the vehicle shows instead of counting from a number it never had.
- **Other writers.** A completion with a `counterValue` of a task that reads the odometer records a
  reading dated the day of the completion (`vehicles/events.ts`, a listener on `completionRecorded`, so
  inside the completion's transaction): a value equal to the reading on or before the completion's date
  (including the counter snapshot a completion takes by itself) adds nothing, a lower one fails the completion
  with a 400 on `counterValue`, undo removes the reading. Without a `counterValue` such a task snapshots the
  reading on or before the completion's date (`readingOnOrBefore`, the last one entered among a day's), not the
  current one, so a completion dated back counts from what the odometer showed that day (dated before the first
  reading it takes no snapshot and the task goes on from its remembered starting value; any other counter, say a
  Home Assistant one, still snapshots its current value); the complete and undo handlers then re-evaluate the other tasks that read
  the same odometer (`refreshOdometerReaders`), so they do not wait for the scheduler. A service log entry's `odometer` (vehicles only, 400 on `odometer` for anything else)
  keeps one reading in step with the entry through create, update (value or date) and delete, in the
  entry's transaction; the handlers re-evaluate the readers at once (`refreshOdometerReaders`). A task that counts on a
  vehicle's odometer says so in the lists: every dashboard task (also `nextTasks` of the statistics) carries
  `odometerAssetId`, the vehicle of its `counter_delta` on `odometer:<asset id>` (`odometerAssetOfTrigger`, read from the
  stored trigger), else null, so a one-tap completion opens the reading dialog without fetching the task first.
- **Tire sets** (`tire_sets`, `tire_set_events`, migration `0020`; `vehicles/tires.ts`, rules in `lib/vehicles/tires.ts`):
  `GET|POST /assets/{id}/tire-sets`, `GET|PATCH|DELETE /tire-sets/{id}`, `POST /assets/{id}/tire-sets/{setId}/mount`,
  `POST /tire-sets/{id}/tread`. A set has season (`summer|winter|all_season`), brand, model, size, `dot` (week and
  year, `"2423"`, validated as week 01-53 plus two digits), tread depth and the day it was measured, storage location
  and contact (a tire hotel), purchase date and `retiredAt`. At most one set per vehicle is `mounted` (partial unique
  index and the mount code). **Mounting** (`mountTireSet`) takes the mounted set off (an `unmounted` event of the same
  day and odometer), writes the `mounted` event and, with an `odometer`, a reading of the vehicle (source `tire_change`,
  the mount event as `sourceId`; lower than the reading before is a 400 on `odometer`), in one transaction; 409 for a
  retired or already mounted set. A mount dated before the day the set it takes off was (last) mounted is a 400 on `date`
  (the same day is fine), so an `unmounted` event never precedes its `mounted` one. Whether a set is mounted and its tread change only through mount and tread (each
  measurement is a `tread_measured` event, the newest is the set's depth, and an `odometer` with it is a reading of the
  same kind and rule as for mounting); `retired: true` takes a mounted set off.
  The DTO carries `treadWarning` (below 3 mm summer, 4 mm winter and all-season, `TREAD_WARNING_MM`), `ageYears` (from
  the DOT, one decimal), `mountedOn` and `distance` (`tireSetDistance`: odometer at the unmount, or the newest reading
  while mounted, minus at the mount; events without an odometer use the newest reading on or before their date).
  Completing a tire-change task does not mount anything: the frontend completes the task, then calls mount. Photos are
  attachments of the owner type `tire_set` (comments and document links are not offered).
- **Fuel log** (`fuel_logs`, migration `0021`; `vehicles/fuel-logs.ts`, consumption in `lib/vehicles/fuel.ts`):
  `GET|POST /assets/{id}/fuel-logs` (list takes `year`) and `GET|PATCH|DELETE /fuel-logs/{id}`; writing needs
  `costs:write` (it books money, like accepting a finance suggestion), reading `read`. A fill has `date`, `odometer`,
  `quantity` and `unit` (`l|kWh`, default by the vehicle's fuel type), `amountMinor` + `currency`, `fullTank`,
  `missedPrevious`, `station`, `notes`. **Creating** is one transaction: the fill, an odometer reading (source
  `fuel_log`, same monotonic rule, 400 on `odometer`) and, unless the amount is 0 (a free charge), a cost entry of the new
  category `fuel` for the vehicle (title "Tanken <station>" or "Laden ..." in the base language, payee = station, paid by
  `paidByUserId`, default the caller). **The book**: `bookId` of the request (an open book, else 400 on `bookId`, also for a
  free fill), else the vehicle's own `costBookId` while that book is open, else the default book; `splitMode` is the one
  asked for, else the split of the book the entry lands in (it used to be `ownership` always). The DTO carries `bookId`
  and `bookName` of the cost entry (null for a free fill). **PATCH** moves the reading with date and
  odometer and keeps the cost entry in step for amount, currency, date, station (title and payee, the unit decides the
  title too), payer, split and book (`bookId` moves the entry as `PATCH /costs/{id}` does, resetting a tax class the new
  book cannot have; the book it is in already is always accepted; on a free fill it changes nothing, and a fill that starts
  costing in the same request is booked into it; made free it loses the entry; costing again gets a new one in the vehicle's
  or default book; an entry somebody deleted is not brought back by other changes). **The fill owns what it booked**: on the cost entry (`PATCH|DELETE /costs/{id}`) a
  change of amount, currency, date or device (`assetId`, which would break the link to the fuel log and the vehicle's
  statistics) and a delete are a 409 `conflict` (message names the fuel log, `details.fuelLogId`;
  repeating the current values is fine, so is every other field: category, title, notes, payee, payer, split, deductible,
  room, defect, service log entry, receipts) and `CostEntry.fuelLogId` points back (null for any other entry, and once
  the fill is gone the entry is free). The fill passes `{fuelLogId}` to `updateCost` to move amount, currency and date (its
  device is the vehicle's and is never sent), and lets go of the entry (`cost_entry_id` null)
  before it deletes it. Title and payee of the entry are rewritten by a change of station or unit only while each still
  equals what the fill wrote last time (`writtenNames`), so a title edited on the cost entry stays; the two are judged apart. **DELETE** removes the reading and the cost entry with its receipts. A fill itself
  takes no attachments, comments or document links: receipts go on its cost entry. Consumption is the full-to-full method (`fuelStretches`): a full fill
  closes a stretch from the previous full fill, partial fills in between are added up, a fill flagged `missedPrevious`
  starts the chain again, litres and kWh are separate chains; the DTO carries `pricePerUnitMinor` (a rate in minor
  units, not an amount), and on a closing fill `distance`, `consumptionPer100` and `costPerDistanceMinor` (unknown when an
  amount in the stretch is in another currency), worked out from the whole log whatever page is asked for.
- **Statistics** (`GET /assets/{id}/vehicle/stats?year=`, all time without a year; `vehicles/stats.ts`, distance maths in
  `lib/vehicles/stats.ts`): `distance` and `distanceByMonth` from the odometer readings (a stretch between two readings
  counts evenly for the days after the first up to the second, so a mid-month reading splits the stretch; nothing before
  the first or after the last reading; a reading lower than the one before adds nothing), `costs` (the vehicle's cost
  entries that count as an expense, household currency only, by category, `otherCurrencyCount` for the rest),
  `costPerDistanceMinor`, `consumption` per unit (average weighted by distance and the last ten, over the stretches closed
  in the period), `priceTrend` (last 24 fills), the mounted `tireSet` and `nextTasks` (at most five, from
  `getUpcomingTasks(ctx, {assetId})`, the dashboard's selector). `GET /costs/summary` takes `assetId` too: everything in
  it is then that asset's alone.
- **Task templates** (`lib/vehicles/templates.ts`, pure, titles are Paraglide messages in the given
  locale): winter and summer tires (yearly calendar, October/April 15th, `earlyDays` 14, preparation
  "Garagentermin buchen" 28 days ahead), service (`counter_delta` on the odometer, 15000 km / 10000 mi,
  `orEvery` 12 months), MFK (`one_off`; `suggestMfkDate` = 4, 7, then every 2 years after the first
  registration), vignette (yearly, end of January), vehicle tax (yearly, payment), brake fluid and
  air-conditioning service (every 2 years). Each returns `{id, task, preparations}`: the frontend sends
  `task` to `POST /tasks`, then each preparation to `POST /tasks/{id}/preparations`. `task` carries the mark
  `externalSource: "vehicle_template"`, `externalRef: "<asset id>:<template id>"` (the pair is unique on the server).

## In the web app

- **Vehicles in the web app**: `assets/[id]` for kind `vehicle` shows `components/vehicles/` first: `VehicleCard` (plate chip,
  odometer with the "record" dialog, details), `OdometerHistoryCard` (delete is offered for every reading; a reading that belongs to
  a completion, service log entry, fuel log entry or tire change is a 409 whose `details.source` is worded by `readingOwner`),
  `TireSetsCard` (sets with tread and age warnings, mount, measure, retire), `FuelLogCard` (anchor `#fuel-log`; consumption and
  price trends as `Sparkline`, a small SVG without a chart library) and `VehicleCostsCard` (`/assets/{id}/vehicle/stats` per year,
  links to `/costs?asset=`). The asset form takes the vehicle details (`PUT /assets/{id}/vehicle` after the asset; vehicles have no
  room picker).
- **Odometer readings in forms**: `VehicleReading` (`lib/vehicles/odometer-state.svelte.ts`) loads a vehicle's unit and newest
  reading for a dialog and `OdometerReadingField` prefills it; an unchanged or empty field sends no reading. A task that counts on the
  odometer asks for it when completed: `CompleteButton` asks `odometerAssetOf(task)` (the dashboard's `odometerAssetId`, else the
  trigger; only a task that has neither is fetched, and a failed lookup completes plainly) and opens `CompleteOdometerDialog`, whose
  reading goes along as `counterValue`; the "with note" dialog has the same field. Odometer fields read "95.000", "95,000" and
  "95'000" as 95000 (`parseOdometerValue`), amounts, litres and millimetres keep their decimals (`parseDecimalInput`). Limits in
  messages go through `formatNumber`, never `toLocaleString("en")`. A refused reading is recognised by `refusedReading(err, field)`
  (`lib/vehicles/odometer-error.ts`) from `details.code` and `details.reading` (`odometerRefusalDetailsSchema`), never from the
  English message, and `refusedMessage` names the reading in the way for `lower_than_previous` and `higher_than_next`. Only the record
  dialog (`POST /assets/{id}/odometer`) can send `force`, so only it offers "save anyway", for both codes; the other forms
  (completion, fuel log, tire mount and tread, service log) show the explanation.
- **Tire change offer**: `completeTask` hands the task the server answers with to `tireOffers` (`lib/vehicles/tire-offer.svelte.ts`);
  if `tireChange(task)` (`tire-task.ts`) says it is a tire change, `TireMountOffer` (in the app layout) offers to mount a set. The
  template mark decides (`tires_winter` / `tires_summer`, any other template never offers); an unmarked task is judged by its title
  ("Reifenwechsel", "Radwechsel", "Winterreifen aufziehen", ...). The mount dialogs take the mounted set's `mountedOn` as the minimum
  date (`mountedSince`) and word the server's 400 on `date`.
- **Setting up a vehicle's tasks**: "Termine einrichten" (`lib/vehicles/setup.ts`, `vehicle-setup-dialog.svelte`) creates the
  templates of `lib/vehicles/templates.ts` through the API, task first, then its preparations, each template with its own progress
  and error. Every template task carries the mark `externalSource: "vehicle_template"`, `externalRef: "<asset id>:<template id>"`
  (`lib/vehicles/template-mark.ts`); the server keeps that pair unique, so on a 409 the task that holds the mark is read (`GET /tasks` with `externalSource`,
  `externalRef` and `includeArchived`, the client's `findMarked`): archived, finished (a one-off that was completed or skipped) or
  moved to another device means the vehicle had the template before, and the creation retries with `:<n>` appended; a task that is
  still there means none is made and the template shows "already there" (`TemplateRun.state` `exists`, the page reloads); a holder
  that is gone by now gets the same mark again. `findExistingTask` finds what a vehicle has already by the mark, and only
  a task without a readable mark by likeness (title in either language, odometer counter, an inspection on a date), so nothing is
  offered twice. A mark is readable (`templateOfMark`) when it names one of `VEHICLE_TEMPLATE_IDS` (defined in `template-mark.ts`,
  re-exported by `templates.ts`); one that names another template counts as unreadable here and in the tire change offer. A new vehicle opens that dialog once through `?termine=1`.
- **Costs of a vehicle**: `/costs?asset=` passes the device on to the summary (`costsSummaryQuery`; no other filter narrows its
  totals) and says so above it. A cost entry with `fuelLogId` has its amount, currency, date and device locked in the form (never sent by
  `buildUpdateBody`) with a link to `#fuel-log`, and the detail page offers that link instead of delete; a 409 with
  `details.fuelLogId` that still arrives is worded (`fuelLogOfConflict`).
