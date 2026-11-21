# Mobile apps (Kotlin Multiplatform)

`mobile/` holds the native apps: an Android app (Jetpack Compose) and an iOS app (SwiftUI) on top of
one shared Kotlin module. They are clients of the REST API like the web app, and they talk to
whatever server the person enters at first start (the server is self-hosted).

## Commands

```bash
source ~/.sdkman/bin/sdkman-init.sh && export ANDROID_HOME=~/android-sdk && cd mobile

./gradlew androidApp:assembleDebug
./gradlew shared:testDebugUnitTest androidApp:testDebugUnitTest   # shared:allTests adds the iOS targets on a Mac
./gradlew shared:ktlintCheck androidApp:ktlintCheck               # fix with shared:ktlintFormat androidApp:ktlintFormat
./gradlew androidApp:lintDebug
./gradlew shared:compileCommonMainKotlinMetadata                    # common code against the common stdlib: catches JVM-only API (toSortedSet, String.format, java.*) that the iOS build would reject
bun run mobile:api                                                # from the repo root, after docs/openapi.json changed
```

CI: `mobile-android.yml`, `mobile-ios.yml`; releases: `mobile-release.yml` and `RELEASING.md`.

## Layout

```
api-generator/generate.ts     OpenAPI -> Kotlin client (run by `bun run mobile:api`; a vitest test fails when stale)
messages/{de,en}/*.json       mobile-only strings (keys start with m_); the web's messages/{de,en}.json are used too
shared/src/commonMain/kotlin/ch/orellbuehler/hauswart/
  api/generated/              generated: one <Tag>Api class per OpenAPI tag, Models.kt, HauswartApi. Never edit.
  api/                        ApiHttp (the only HTTP code), ApiException, Patch
  core/                       Store (base of every screen's logic), UiError, Money, Dates, fetchAll
  i18n/                       I18n / tr(): the message files compiled into the module
  session/, platform/         who is signed in to which server; secure and plain storage per platform
  HauswartApp.kt              the root object (api, session, household, changed()); one per process
  feature/<name>/             the stores of a feature, one package per feature
androidApp/src/androidMain/kotlin/ch/orellbuehler/hauswart/android/
  ui/<feature>/               screens of a feature and its <Feature>Nav.kt
  ui/components/              the UI kit every screen is built from
  ui/nav/Routes.kt            destinations other features link to
iosApp/Hauswart/
  Features/<Feature>/         screens of a feature
  Support/                    Observed (store glue), tr(), the UI kit, Route
  project.yml                 XcodeGen; the .xcodeproj and Info.plist are generated and gitignored
```

## Rules

- **All logic is in `shared`.** A screen has a store (`class XStore(app: HauswartApp, ...) : Store<XState>`).
  The apps render `state` and call the store's plain functions; they contain no API calls, no
  validation, no formatting rules and no business decisions. If both apps would need the same `if`,
  it belongs in the store or in a function next to it.
- **State is one immutable data class per store** with plain fields: `loading`, `error: UiError?`, the
  data, and for one-shot outcomes a field the screen reacts to (`savedId`, `deleted`). No generic
  wrapper types, no sealed state hierarchies, no callbacks into the UI: Swift has to read it.
- **Store functions never suspend and never throw.** They start work with `launch({ e -> ... }) { ... }`
  and report failures through the state. Swift never calls a suspend function.
- **Forms:** the store offers `initial: XForm?` (a data class of strings and booleans as typed) and
  `save(form)`. The screen keeps its own copy of the form while the person types and hands it back.
  The store validates, builds the request and sets `fieldErrors` (keyed by the request's field
  names) or `savedId`.
- **After a write call `app.changed("<topic>")`** and let stores that show the data reload with
  `onChange(app, "<topic>") { load() }`. Topics are the plural domain names (list in `HauswartApp`).
- **The generated client:** enums are strings (allowed values in the KDoc and in `X.FIELD_VALUES`), a
  newer server may send values this build does not know, so always have an `else`. A class name can
  be surprising when two schemas have the same shape; trust the function signature. Unions with a
  constant `type`/`kind` are sealed classes with an `Unknown` member; other unions are `JsonElement`.
  In PATCH/PUT bodies a nullable field is a `Patch<T>`: `Patch.Keep` (default, not sent),
  `Patch.of(value)`, `Patch.of(null)` to clear. Other optional fields are `null` = not sent.
  Endpoints a device token cannot call (session only: password, API tokens, users, calendar feeds,
  guest links) are not generated; those stay in the web app.
- **Dates and money as on the server:** dates are `YYYY-MM-DD` strings in the household's time zone
  (`app.household.today()`, never the device's zone), instants are UTC ISO strings, money is integer
  minor units plus currency. Show them with `Dates` and `Money` from `core/`.
- **Strings:** every text on screen is `tr("key")` / `tr("key", "name" to value)` (Kotlin) or
  `tr("key")` / `tr("key", ["name": value])` (Swift). Use the web's key when one says the same thing
  (`messages/de.json`, 4000 keys: `common_save`, `nav_tasks`, `contact_name`, ...); add a mobile key
  only for what the web has no text for, to `messages/de/<feature>.json` and `messages/en/<feature>.json`
  together, prefixed `m_`. German uses Swiss spelling (ss, never eszett). A test fails on a literal
  key that does not exist, in Kotlin and in Swift. No hardcoded UI text (Android lint fails on it).
- **Both platforms.** Every feature ships on Android and iOS, with the same screens and the same
  behaviour. Say in the commit message when one is deferred.
- **The web app is the specification.** A mobile screen does what the page under `src/routes/(app)`
  does; read the page, its components and the domain's rule file in `.claude/rules/` first.
- Tests: stores are tested in `shared/src/commonTest` against Ktor's `MockEngine` (see
  `feature/contacts/ContactsStoresTest.kt` for the pattern). Bug fixes start with a failing test.

## What exists

Every area of the web app has its screens: home, tasks (with the trigger editor), appointments,
inventory (devices, plants, rooms, warranties), vehicles, defects, parts, contacts, costs (entries,
quick entry, balances, budgets, recurring costs, inbox, receipts, books, tags), docs, documents,
emergency, insurance, notifications, search, settings and local reminders (`feature/reminders`,
planned on the device from the server's data; there is no push service).

- Sections other screens embed: comments, attachments, document links, appointments (Android
  `ui/sections/`, iOS `Features/Comments|Attachments|DocumentLinks|Sections`; usage notes at the top
  of each file). Links between screens go through `AppLink` (`feature/applink`).
- Store tests use `testing/TestApp.kt` (mock server, `store.await { ... }`). A store reloads after
  its own `app.changed(...)`, so a test answers the reload too.
- `SwiftNamesTest` and `MessageKeysUsedTest` (in `shared:testDebugUnitTest`) check the Swift sources
  for what can be checked without a compiler: duplicate type names, names that shadow shared classes,
  `FooKt.bar` references that do not exist, reserved Objective-C method families, unknown message keys.
- Known limit of the generated client: in a POST body an optional nullable field cannot be sent as an
  explicit `null` (it is left out, so the server's default applies). Where that matters a store builds
  the body by hand (`feature/defects/DefectRequests.kt`, `feature/inbox/SuggestionRequests.kt`,
  `feature/appointments/AppointmentRequests.kt`, `feature/vehicles/FuelRequests.kt`).
- Work that must outlive its screen (uploads) runs in `app.background` through `Store.launchIn`; the store is
  updated when it ends, whether or not it is still open, and other screens learn through `app.changed(...)`.
- Android: `tr()` reads the language as UI state (`LocaleTracker`, hooked into `I18n.onRead`), so a language change
  draws the screens again and `rememberStore` makes their stores again; the navigation stays. On sign-out
  `StoreRegistry.closeAll()` closes every store.

## Android

Compose and Material 3. A screen is `@Composable fun XScreen(nav: NavController, ...)`; it gets its
store with `rememberStore { XStore(it) }` and its state with `store.collect()` (`ui/StoreGlue.kt`).
Build screens from `ui/components/` (scaffold with top bar, loading / error / empty states, rows,
form fields, confirm dialog) before writing new layout code. Labels must hold up in German at 360 dp:
one line with ellipsis in rows and buttons, long choices in a dropdown instead of segmented buttons.

## iOS

SwiftUI, iOS 17 and later, project generated by XcodeGen. **Swift is not compiled on Linux: CI is the only
compiler** (`mobile-ios.yml`; read its failed log with `gh run view <id> --log-failed`). Write Swift
conservatively and copy the patterns of existing screens exactly:

- A screen is a `struct XScreen: View` holding `@StateObject private var model = Observed(XStore(app: AppEnv.app))`
  (`Support/Observed.swift`); read `model.state`, call `model.store.function()`.
- Kotlin types in Swift: `String?` is `String?`, `Long` is `Int64`, `Long?` is `KotlinLong?`
  (`.int64Value`), `Boolean?` is `KotlinBoolean?` (`.boolValue`), `List<T>` is `[T]`,
  `Map<String, String>` is `[String: String]`. A Kotlin property named `description` is
  `description_` in Swift. Data classes have no `copy` in Swift: build a new one with every argument.
  Kotlin default arguments do not exist in Swift: pass every argument.
- Top-level Kotlin functions of file `Foo.kt` are `FooKt.function(...)`; `object X` is `X.shared`.
- The generated models `Task` and `Notification` share their names with Swift's `Task` and
  Foundation's `Notification`: write `shared.Task` / `shared.Notification` for the models, and do not
  start Swift concurrency tasks at all (stores do the asynchronous work).
- A Kotlin function Swift calls must not be named `new...`, `init...`, `alloc...` or `copy...`:
  Objective-C reserves those families and the function is exported under another name. Name it
  `blankForm`, `startForm`, `duplicate` and the like.
- Kotlin `Int` is `Int32` in Swift (`String(value)` and comparisons work; convert with `Int(value)`
  where a Swift `Int` is needed).
- Sealed classes are switched with `onEnum(of: value)` (SKIE).
- The language mode is Swift 5 with minimal concurrency checking; views and models are `@MainActor`.
- Every new Swift file is picked up automatically (XcodeGen globs `Hauswart/`).
