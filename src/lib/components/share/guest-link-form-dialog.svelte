<script lang="ts">
  import DicesIcon from "@lucide/svelte/icons/dices";
  import TriangleAlertIcon from "@lucide/svelte/icons/triangle-alert";
  import { toast } from "svelte-sonner";
  import { api } from "$lib/api/browser";
  import {
    GUEST_SECTIONS,
    USER_LOCALES,
    type GuestSection,
    type UserLocale,
  } from "$lib/api/enums";
  import { endpoints } from "$lib/api/registry";
  import type { DocPageSummary } from "$lib/api/schemas/docs";
  import {
    GUEST_LABEL_MAX,
    GUEST_PIN_PATTERN,
    type CreatedGuestLink,
    type GuestLink,
  } from "$lib/api/schemas/share";
  import FormDialog from "$lib/components/app/form-dialog.svelte";
  import SwitchField from "$lib/components/app/switch-field.svelte";
  import Field from "$lib/components/tasks/field.svelte";
  import Segmented from "$lib/components/tasks/segmented.svelte";
  import { Button } from "$lib/components/ui/button/index.js";
  import { Checkbox } from "$lib/components/ui/checkbox/index.js";
  import { Input } from "$lib/components/ui/input/index.js";
  import { Label } from "$lib/components/ui/label/index.js";
  import { localDateOf } from "$lib/dates";
  import { apiErrorMessage } from "$lib/error-message";
  import { m } from "$lib/paraglide/messages";
  import { getLocale } from "$lib/paraglide/runtime";
  import {
    guestSectionHints,
    guestSectionLabels,
    generatePin,
  } from "$lib/share/labels";
  import {
    defaultUntil,
    endInstant,
    latestUntil,
    startInstant,
  } from "$lib/share/window";
  import { sectionLabels } from "$lib/docs/sections";
  import { addDays } from "$lib/dates";
  import { apiFieldErrors } from "$lib/tasks/field-errors";

  type PinMode = "none" | "set" | "keep";

  let {
    open = $bindable(false),
    link,
    pages,
    timeZone,
    today,
    oncreated,
    onsaved,
  }: {
    open?: boolean;
    /** The link to edit; undefined creates a new one. */
    link?: GuestLink | undefined;
    pages: DocPageSummary[];
    timeZone: string;
    today: string;
    oncreated: (
      link: CreatedGuestLink,
      pin: string | null,
    ) => void | Promise<void>;
    onsaved: () => void | Promise<void>;
  } = $props();

  const PAGE_SECTIONS: readonly string[] = ["emergency", "rules", "howto"];
  const PAGE_ORDER = [
    "emergency",
    "rules",
    "howto",
    "general",
    "device",
    "room",
  ];
  const DURATIONS = [7, 14, 30, 90] as const;

  let label = $state("");
  let from = $state("");
  let until = $state("");
  let pinMode = $state<PinMode>("none");
  let pin = $state("");
  let includeSecrets = $state(false);
  let sections = $state<GuestSection[]>([]);
  let pageIds = $state<string[]>([]);
  let locale = $state<string>("de");
  let fieldErrors = $state<Record<string, string>>({});

  const editing = $derived(link !== undefined);
  const guestPages = $derived(
    pages
      .filter((p) => p.guestVisible)
      .sort(
        (a, b) =>
          PAGE_ORDER.indexOf(a.section) - PAGE_ORDER.indexOf(b.section) ||
          a.title.localeCompare(b.title),
      ),
  );
  const hiddenPages = $derived(pages.length - guestPages.length);
  const maxUntil = $derived(latestUntil(today));
  const pinOptions = $derived(
    link?.hasPin
      ? [
          { value: "keep" as const, label: m.glinks_pin_keep() },
          { value: "set" as const, label: m.glinks_pin_change() },
          { value: "none" as const, label: m.glinks_pin_remove() },
        ]
      : [
          { value: "none" as const, label: m.glinks_pin_none() },
          { value: "set" as const, label: m.glinks_pin_set() },
        ],
  );
  const localeOptions = $derived(
    USER_LOCALES.map((value) => ({
      value,
      label: value === "de" ? m.locale_name_de() : m.locale_name_en(),
    })),
  );
  const covered = (page: DocPageSummary) =>
    PAGE_SECTIONS.includes(page.section) &&
    sections.includes(page.section as GuestSection);

  $effect(() => {
    if (!open) return;
    label = link?.label ?? "";
    from = link?.startsAt
      ? localDateOf(timeZone, Date.parse(link.startsAt))
      : "";
    until = link
      ? localDateOf(timeZone, Date.parse(link.expiresAt))
      : defaultUntil(today);
    pinMode = link?.hasPin ? "keep" : "none";
    pin = "";
    includeSecrets = link?.includeSecrets ?? false;
    sections = link ? [...link.sections] : [...GUEST_SECTIONS];
    pageIds = link ? [...link.pageIds] : [];
    locale = link?.locale ?? getLocale();
    fieldErrors = {};
  });

  function toggleSection(section: GuestSection, checked: boolean) {
    sections = checked
      ? GUEST_SECTIONS.filter((s) => s === section || sections.includes(s))
      : sections.filter((s) => s !== section);
  }

  function togglePage(id: string, checked: boolean) {
    pageIds = checked ? [...pageIds, id] : pageIds.filter((p) => p !== id);
  }

  const sameSet = (a: readonly string[], b: readonly string[]) =>
    a.length === b.length && a.every((x) => b.includes(x));

  async function submit(): Promise<string | void> {
    fieldErrors = {};
    const errors: Record<string, string> = {};
    if (!label.trim()) errors.label = m.field_required();
    if (!until) errors.until = m.field_required();
    else if (until < today) errors.until = m.glinks_until_past();
    else if (until > maxUntil) errors.until = m.glinks_until_max({ days: 90 });
    if (from && until && from > until) errors.from = m.glinks_from_after();
    if (pinMode === "set" && !GUEST_PIN_PATTERN.test(pin))
      errors.pin = m.glinks_pin_invalid();
    if (Object.keys(errors).length > 0) {
      fieldErrors = errors;
      return m.form_check_fields();
    }

    const now = Date.now();
    const fromChanged =
      !link ||
      from !==
        (link.startsAt ? localDateOf(timeZone, Date.parse(link.startsAt)) : "");
    const untilChanged =
      !link || until !== localDateOf(timeZone, Date.parse(link.expiresAt));
    const startsAt =
      from && from > today
        ? new Date(startInstant(from, timeZone)).toISOString()
        : null;
    const expiresAt = new Date(endInstant(until, timeZone, now)).toISOString();
    const orderedSections = GUEST_SECTIONS.filter((s) => sections.includes(s));

    try {
      if (!link) {
        const created = await api.call(endpoints.guestLinksCreate, {
          body: {
            label: label.trim(),
            startsAt,
            expiresAt,
            pin: pinMode === "set" ? pin : null,
            includeSecrets,
            sections: orderedSections,
            pageIds,
            locale: locale as UserLocale,
          },
        });
        toast.success(m.glinks_created_toast({ label: created.label }));
        await oncreated(created, pinMode === "set" ? pin : null);
        return;
      }
      const body = {
        ...(label.trim() !== link.label ? { label: label.trim() } : {}),
        ...(fromChanged ? { startsAt } : {}),
        ...(untilChanged ? { expiresAt } : {}),
        ...(pinMode === "set"
          ? { pin }
          : pinMode === "none" && link.hasPin
            ? { pin: null }
            : {}),
        ...(includeSecrets !== link.includeSecrets ? { includeSecrets } : {}),
        ...(!sameSet(orderedSections, link.sections)
          ? { sections: orderedSections }
          : {}),
        ...(!sameSet(pageIds, link.pageIds) ? { pageIds } : {}),
        ...(locale !== link.locale ? { locale: locale as UserLocale } : {}),
      };
      if (Object.keys(body).length > 0) {
        await api.call(endpoints.guestLinksUpdate, {
          params: { id: link.id },
          body,
        });
        toast.success(m.glinks_saved_toast({ label: label.trim() }));
      }
      await onsaved();
    } catch (err) {
      fieldErrors = apiFieldErrors(err);
      if (Object.keys(fieldErrors).length > 0) return m.form_check_fields();
      return apiErrorMessage(err);
    }
  }
</script>

<FormDialog
  bind:open
  title={editing ? m.glinks_edit_title() : m.glinks_create_title()}
  description={editing
    ? m.glinks_edit_description()
    : m.glinks_create_description()}
  submitLabel={editing ? m.common_save() : m.glinks_create_submit()}
  pendingLabel={editing ? m.common_saving() : m.common_creating()}
  onsubmit={submit}
  class="sm:max-w-xl"
>
  <Field
    id="glink-label"
    label={m.glinks_label()}
    hint={m.glinks_label_hint()}
    error={fieldErrors.label}
  >
    {#snippet children({ describedby, invalid })}
      <Input
        id="glink-label"
        autocomplete="off"
        maxlength={GUEST_LABEL_MAX}
        placeholder={m.glinks_label_placeholder()}
        aria-invalid={invalid || undefined}
        aria-describedby={describedby}
        class="h-10"
        bind:value={label}
      />
    {/snippet}
  </Field>

  <fieldset class="flex flex-col gap-4">
    <legend class="mb-3 text-sm font-medium">{m.glinks_validity()}</legend>
    <div class="grid gap-4 sm:grid-cols-2">
      <Field
        id="glink-from"
        label={m.glinks_from()}
        hint={m.glinks_from_hint()}
        optional
        error={fieldErrors.from}
      >
        {#snippet children({ describedby, invalid })}
          <Input
            id="glink-from"
            type="date"
            min={today}
            max={maxUntil}
            aria-invalid={invalid || undefined}
            aria-describedby={describedby}
            class="h-10"
            bind:value={from}
          />
        {/snippet}
      </Field>
      <Field
        id="glink-until"
        label={m.glinks_until()}
        hint={m.glinks_until_hint({ days: 90 })}
        error={fieldErrors.until ?? fieldErrors.expiresAt}
      >
        {#snippet children({ describedby, invalid })}
          <Input
            id="glink-until"
            type="date"
            min={today}
            max={maxUntil}
            aria-invalid={invalid || undefined}
            aria-describedby={describedby}
            class="h-10"
            bind:value={until}
          />
        {/snippet}
      </Field>
    </div>
    <div class="flex flex-wrap items-center gap-2">
      <span class="text-muted-foreground text-xs">{m.glinks_quick_until()}</span
      >
      {#each DURATIONS as days (days)}
        <Button
          type="button"
          variant={until === addDays(today, days) ? "secondary" : "outline"}
          size="sm"
          onclick={() => (until = addDays(today, days))}
        >
          {m.glinks_quick_days({ days })}
        </Button>
      {/each}
    </div>
  </fieldset>

  <fieldset class="flex flex-col gap-3">
    <legend class="mb-1 text-sm font-medium">{m.glinks_pin()}</legend>
    <Segmented
      label={m.glinks_pin()}
      options={pinOptions}
      value={pinMode}
      onchange={(next) => {
        pinMode = next;
        if (next === "set" && !pin) pin = generatePin();
      }}
    />
    {#if pinMode === "set"}
      <Field
        id="glink-pin"
        label={m.glinks_pin_value()}
        hint={m.glinks_pin_hint()}
        error={fieldErrors.pin}
      >
        {#snippet children({ describedby, invalid })}
          <div class="flex items-stretch gap-2">
            <Input
              id="glink-pin"
              inputmode="numeric"
              autocomplete="off"
              maxlength={8}
              aria-invalid={invalid || undefined}
              aria-describedby={describedby}
              class="h-10 font-mono tracking-widest tabular-nums"
              bind:value={pin}
            />
            <Button
              type="button"
              variant="outline"
              class="h-10"
              onclick={() => (pin = generatePin())}
            >
              <DicesIcon />{m.glinks_pin_generate()}
            </Button>
          </div>
        {/snippet}
      </Field>
    {:else if pinMode === "keep"}
      <p class="text-muted-foreground text-xs text-pretty">
        {m.glinks_pin_keep_hint()}
      </p>
    {:else}
      <p class="text-muted-foreground text-xs text-pretty">
        {m.glinks_pin_none_hint()}
      </p>
    {/if}
  </fieldset>

  <fieldset class="flex flex-col gap-3">
    <legend class="mb-1 text-sm font-medium">{m.glinks_sections()}</legend>
    <p class="text-muted-foreground -mt-1 text-xs text-pretty">
      {m.glinks_sections_hint()}
    </p>
    {#each GUEST_SECTIONS as section (section)}
      <div class="flex items-start gap-3">
        <Checkbox
          id={`glink-section-${section}`}
          class="mt-0.5"
          checked={sections.includes(section)}
          onCheckedChange={(checked) => toggleSection(section, checked)}
        />
        <Label
          for={`glink-section-${section}`}
          class="flex flex-col items-start gap-0.5"
        >
          <span>{guestSectionLabels[section]()}</span>
          <span class="text-muted-foreground text-xs font-normal text-pretty">
            {guestSectionHints[section]()}
          </span>
        </Label>
      </div>
    {/each}
  </fieldset>

  <details class="group rounded-lg border">
    <summary
      class="focus-visible:ring-ring/50 flex min-h-11 cursor-pointer list-none items-center justify-between gap-2 rounded-lg px-3 py-2 text-sm font-medium outline-none focus-visible:ring-[3px]"
    >
      <span>
        {m.glinks_pages()}
        {#if pageIds.length > 0}
          <span class="text-muted-foreground font-normal tabular-nums">
            ({pageIds.length})
          </span>
        {/if}
      </span>
      <span
        class="text-muted-foreground text-xs group-open:hidden"
        aria-hidden="true">{m.glinks_pages_show()}</span
      >
    </summary>
    <div class="flex flex-col gap-3 border-t px-3 py-3">
      <p class="text-muted-foreground text-xs text-pretty">
        {m.glinks_pages_hint()}
      </p>
      {#if guestPages.length === 0}
        <p class="text-sm text-pretty">{m.glinks_pages_empty()}</p>
      {:else}
        <ul class="flex flex-col gap-2.5">
          {#each guestPages as page (page.id)}
            {@const viaSection = covered(page)}
            <li class="flex items-start gap-3">
              <Checkbox
                id={`glink-page-${page.id}`}
                class="mt-0.5"
                checked={viaSection || pageIds.includes(page.id)}
                disabled={viaSection}
                onCheckedChange={(checked) => togglePage(page.id, checked)}
              />
              <Label
                for={`glink-page-${page.id}`}
                class="flex min-w-0 flex-col items-start gap-0.5"
              >
                <span class="break-words">{page.title}</span>
                <span class="text-muted-foreground text-xs font-normal">
                  {sectionLabels[page.section]()}{viaSection
                    ? ` · ${m.glinks_pages_via_section()}`
                    : ""}
                </span>
              </Label>
            </li>
          {/each}
        </ul>
      {/if}
      {#if hiddenPages > 0}
        <p class="text-muted-foreground text-xs text-pretty">
          {m.glinks_pages_hidden({ count: hiddenPages })}
        </p>
      {/if}
    </div>
  </details>

  <div class="flex flex-col gap-3">
    <SwitchField
      id="glink-secrets"
      bind:checked={includeSecrets}
      label={m.glinks_secrets()}
      hint={m.glinks_secrets_hint()}
    />
    {#if includeSecrets}
      <div
        class="border-destructive/40 bg-destructive/5 text-destructive flex items-start gap-2 rounded-lg border p-3 text-sm"
        role="note"
      >
        <TriangleAlertIcon class="mt-0.5 size-4 shrink-0" aria-hidden="true" />
        <p class="text-pretty">
          {pinMode === "none"
            ? m.glinks_secrets_warning_no_pin()
            : m.glinks_secrets_warning()}
        </p>
      </div>
    {/if}
  </div>

  <div class="flex flex-col gap-2">
    <span class="text-sm leading-none font-medium">{m.glinks_locale()}</span>
    <Segmented
      label={m.glinks_locale()}
      options={localeOptions}
      value={locale as UserLocale}
      onchange={(next) => (locale = next)}
    />
    <p class="text-muted-foreground text-xs text-pretty">
      {m.glinks_locale_hint()}
    </p>
  </div>
</FormDialog>
