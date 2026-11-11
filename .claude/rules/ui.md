---
paths:
  - "src/routes/?app?/**"
  - "src/routes/{g,login,setup,offline}/**"
  - "src/routes/+layout.svelte"
  - "src/lib/components/**"
  - "src/lib/overlays/**"
  - "src/app.css"
---

# Phones and the installed app

- **Shell** (`(app)/+layout.svelte`): below `md` a bottom tab bar (`components/app/bottom-nav.svelte`; tabs in
  `nav.ts` `mobileTabs`, "More" opens the sidebar sheet) replaces the hamburger; it hides on `/new` and `/edit`
  routes and while a field that opens the keyboard has focus. `--bottom-nav` (on `:root`, `0px` unless the bar is
  shown) positions everything fixed at the bottom: always write `var(--bottom-nav, 0px)` in `calc()`. The content
  wrapper already pads for the bar plus a floating button, so pages add no bottom padding; floating "new" buttons
  use `components/app/fab.svelte`. The mobile header shows a back arrow on nested routes (`back-target.ts`, a link,
  never `history.back()`), so in-page "back to …" links are `max-md:hidden`. A navigation progress bar and an
  `invalidateAll()` after more than 60 s in the background are part of the shell.
- **Touch sizes come from the primitives**: `ui/*` add `pointer-coarse:` heights (buttons, inputs, select and menu
  items, tabs 40 px; lg 44 px; switch/checkbox hit areas). Do not hand-size plain buttons; avoid hard-coded `h-8` /
  `size-7` on things people tap. Desktop (fine pointer) keeps the compact sizes.
- **Overflow**: a long unbroken word must never widen the page. Grids get a base track (`grid-cols-1`), flex/grid
  children `min-w-0`, label/value lists `minmax(0,1fr)`, titles and values `wrap-anywhere` (`break-words` does not
  lower min-content). Inputs stay `text-base md:text-sm` (iOS zooms on focus below 16 px).
- **Dialogs and sheets** anchor to the top on phones, scroll inside `max-h-[calc(100dvh-2rem)]`, and `FormDialog`
  keeps its footer pinned. The system back gesture closes them (`lib/overlays/`, shallow routing with
  `App.PageState.overlay`); opt out with `closeOnBack={false}` (e.g. a prompt opened from `beforeNavigate`). A dialog
  that navigates afterwards uses `gotoFromOverlay` (`lib/overlays/use-overlay-history.svelte`): it pops the overlay's
  entries first (`popAll`) and navigates from the page below, so Back leads to that page with its own content. Never
  replace an overlay's entry (no `data-sveltekit-replacestate`, no `replaceState` after a pushState): a shallow entry
  shares the router's navigation index with the page below, so Back would change only the address. A click on a link
  inside an overlay gets the same treatment from the `beforeNavigate` in `useOverlayHistory` (cancel, pop, `goto`); a
  plain `goto` from an open overlay leaves its entry behind. `FormDialog`/`ConfirmDialog` give up their entry while
  their action runs. Long forms on pages get a sticky bottom save bar.
- **Information is not hover-only**: anything in `title=` that matters (exact dates, amounts) is also visible on touch.
- **After a dialog, refresh with `invalidateAfterOverlay`** (`lib/overlays/use-overlay-history.svelte.ts`): closing a dialog pops its history
  entry, and the router drops an `invalidateAll()` that is still loading when that popstate arrives, so the page kept the old data. It waits
  for the entry to be gone first (`OverlayHistory.settled`); a dialog that navigates uses `gotoFromOverlay`. Menu items that start
  an action with `onclick` do not disable themselves while it runs: bits-ui checks `disabled` after `onclick`, so the
  item no longer selects, the menu does not close and the page stays locked. Items that use `onSelect` are fine (the
  check comes before it runs).
