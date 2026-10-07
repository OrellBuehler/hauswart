<script lang="ts">
  import LoaderCircleIcon from "@lucide/svelte/icons/loader-circle";
  import { untrack } from "svelte";
  import { SvelteMap } from "svelte/reactivity";
  import { goto } from "$app/navigation";
  import { resolve } from "$app/paths";
  import { toast } from "svelte-sonner";
  import { api } from "$lib/api/browser";
  import {
    COST_CATEGORIES,
    COST_CATEGORY_COUNTS_AS_EXPENSE,
    COST_DEDUCTIBLE,
    type CostCategory,
  } from "$lib/api/enums";
  import { endpoints } from "$lib/api/registry";
  import type { Asset } from "$lib/api/schemas/assets";
  import type { CostEntry } from "$lib/api/schemas/costs";
  import type { Defect } from "$lib/api/schemas/defects";
  import type { Room } from "$lib/api/schemas/rooms";
  import type { ServiceLogEntry } from "$lib/api/schemas/service-log";
  import type { DirectoryUser } from "$lib/api/schemas/users";
  import FormAlert from "$lib/components/app/form-alert.svelte";
  import SwitchField from "$lib/components/app/switch-field.svelte";
  import Field from "$lib/components/tasks/field.svelte";
  import OptionSelect from "$lib/components/tasks/option-select.svelte";
  import Segmented from "$lib/components/tasks/segmented.svelte";
  import { Button } from "$lib/components/ui/button/index.js";
  import * as Card from "$lib/components/ui/card/index.js";
  import { Input } from "$lib/components/ui/input/index.js";
  import { Textarea } from "$lib/components/ui/textarea/index.js";
  import {
    buildCreateBody,
    buildUpdateBody,
    draftFromEntry,
    newDraft,
    parseDraftAmount,
    type CostDraft,
  } from "$lib/costs/form";
  import { categoryLabels, deductibleLabels } from "$lib/costs/labels";
  import { COST_NOTES_MAX, COST_TITLE_MAX } from "$lib/api/schemas/costs";
  import { apiErrorMessage } from "$lib/error-message";
  import { formatDay } from "$lib/format";
  import { m } from "$lib/paraglide/messages";
  import { apiFieldErrors } from "$lib/tasks/field-errors";
  import SplitEditor from "./split-editor.svelte";

  let {
    entry,
    rooms,
    assets,
    defects,
    people,
    currency,
    today,
    currentUserId,
    defaults = {},
  }: {
    entry?: CostEntry | undefined;
    rooms: Room[];
    assets: Asset[];
    defects: Defect[];
    people: DirectoryUser[];
    /** The household's currency. */
    currency: string;
    today: string;
    currentUserId: string;
    defaults?: {
      assetId?: string | undefined;
      roomId?: string | undefined;
      defectId?: string | undefined;
    };
  } = $props();

  const userIds = untrack(() => people.map((p) => p.id));

  let draft = $state<CostDraft>(
    untrack(() =>
      entry
        ? draftFromEntry(entry, userIds)
        : newDraft({
            today,
            currency,
            paidByUserId: people.some((p) => p.id === currentUserId)
              ? currentUserId
              : "",
            userIds,
            ...defaults,
          }),
    ),
  );

  let errors = $state<Record<string, string>>({});
  let formError = $state<string | undefined>();
  let pending = $state(false);
  let formEl = $state<HTMLFormElement | null>(null);

  let serviceEntries = $state.raw<ServiceLogEntry[]>([]);
  let serviceLoading = $state(false);
  let serviceError = $state<string | undefined>();
  let serviceRun = 0;
  /** Every service log entry the form has seen, to tell which device an entry belongs to. */
  const knownServiceEntries = new SvelteMap<string, ServiceLogEntry>();

  const categoryOptions = $derived(
    COST_CATEGORIES.map((c) => ({ value: c, label: categoryLabels[c]() })),
  );
  const deductibleOptions = $derived(
    COST_DEDUCTIBLE.map((d) => ({ value: d, label: deductibleLabels[d]() })),
  );
  const kindOptions = $derived([
    { value: "expense" as const, label: m.cost_kind_expense() },
    { value: "refund" as const, label: m.cost_kind_refund() },
  ]);
  const assetOptions = $derived([
    { value: "", label: m.cost_no_asset() },
    ...assets.map((a) => ({
      value: a.id,
      label: a.roomName ? `${a.name} (${a.roomName})` : a.name,
    })),
  ]);
  const roomOptions = $derived([
    { value: "", label: m.cost_no_room() },
    ...rooms.map((r) => ({ value: r.id, label: r.name })),
  ]);
  const defectOptions = $derived([
    { value: "", label: m.cost_no_defect() },
    ...defects.map((d) => ({
      value: d.id,
      label: `#${d.number} ${d.title}`,
    })),
    ...(entry?.defectId && !defects.some((d) => d.id === entry.defectId)
      ? [
          {
            value: entry.defectId,
            label:
              `#${entry.defectNumber ?? ""} ${entry.defectTitle ?? ""}`.trim(),
          },
        ]
      : []),
  ]);
  const serviceOptions = $derived([
    { value: "", label: m.cost_no_service_entry() },
    ...serviceEntries.map((s) => ({
      value: s.id,
      label: [
        formatDay(s.date),
        s.title,
        draft.assetId ? null : `(${s.assetName})`,
      ]
        .filter(Boolean)
        .join(" · "),
    })),
    ...(draft.serviceLogId &&
    !serviceEntries.some((s) => s.id === draft.serviceLogId)
      ? [
          {
            value: draft.serviceLogId,
            label:
              (draft.serviceLogId === entry?.serviceLogId
                ? entry.serviceLogTitle
                : knownServiceEntries.get(draft.serviceLogId)?.title) ??
              m.cost_service_entry_linked(),
          },
        ]
      : []),
  ]);
  const payerOptions = $derived([
    { value: "", label: m.cost_payer_none() },
    ...people.map((p) => ({ value: p.id, label: p.displayName })),
  ]);
  const amount = $derived(
    parseDraftAmount(draft.amount, draft.refund, draft.currency),
  );
  const showPayerHint = $derived(
    draft.splitMode !== "none" && draft.paidByUserId === "",
  );
  const otherCurrency = $derived(
    /^[A-Z]{3}$/.test(draft.currency) && draft.currency !== currency,
  );

  $effect(() => {
    const asset = draft.assetId;
    const run = ++serviceRun;
    untrack(() => {
      serviceLoading = true;
      serviceError = undefined;
    });
    api
      .call(endpoints.serviceLogList, {
        query: { limit: 100, ...(asset ? { assetId: asset } : {}) },
      })
      .then((page) => {
        if (run !== serviceRun) return;
        serviceEntries = page.items;
        for (const s of page.items) knownServiceEntries.set(s.id, s);
      })
      .catch((err: unknown) => {
        if (run !== serviceRun) return;
        serviceEntries = [];
        serviceError = apiErrorMessage(err);
      })
      .finally(() => {
        if (run === serviceRun) serviceLoading = false;
      });
  });

  function pickCategory(next: string) {
    if (!draft.countsTouched) {
      draft.countsAsExpense =
        COST_CATEGORY_COUNTS_AS_EXPENSE[next as CostCategory];
    }
  }

  function pickAsset(next: string) {
    const linked = knownServiceEntries.get(draft.serviceLogId);
    if (linked && linked.assetId !== next) draft.serviceLogId = "";
  }

  function pickServiceEntry(next: string) {
    const picked = knownServiceEntries.get(next);
    if (picked && !draft.assetId) draft.assetId = picked.assetId;
  }

  function onCurrencyInput(event: Event & { currentTarget: HTMLInputElement }) {
    draft.currency = event.currentTarget.value
      .toUpperCase()
      .replace(/[^A-Z]/g, "");
  }

  function focusFirstError() {
    queueMicrotask(() => {
      const invalid = formEl?.querySelector<HTMLElement>(
        "[aria-invalid='true']",
      );
      invalid?.scrollIntoView({ block: "center" });
      invalid?.focus();
    });
  }

  async function submit(event: SubmitEvent) {
    event.preventDefault();
    if (pending) return;
    formError = undefined;
    const built = entry
      ? buildUpdateBody(draft, entry, userIds)
      : buildCreateBody(draft, userIds);
    errors = built.errors;
    if (!built.body) {
      formError = m.form_check_fields();
      focusFirstError();
      return;
    }
    if (entry && Object.keys(built.body).length === 0) {
      toast.info(m.cost_form_no_changes());
      await goto(resolve(`/costs/${entry.id}` as "/"));
      return;
    }
    pending = true;
    try {
      const saved = entry
        ? await api.call(endpoints.costsUpdate, {
            params: { id: entry.id },
            body: built.body as never,
          })
        : await api.call(endpoints.costsCreate, {
            body: built.body as never,
          });
      toast.success(
        entry
          ? m.cost_saved_toast({ title: saved.title })
          : m.cost_created_toast({ title: saved.title }),
      );
      await goto(resolve(`/costs/${saved.id}` as "/"), {
        invalidateAll: true,
      });
    } catch (err) {
      errors = apiFieldErrors(err);
      formError = apiErrorMessage(err);
      focusFirstError();
    } finally {
      pending = false;
    }
  }

  const cancelHref = $derived(
    entry ? resolve(`/costs/${entry.id}` as "/") : resolve("/costs"),
  );
</script>

<form
  bind:this={formEl}
  class="flex flex-col gap-6"
  onsubmit={submit}
  novalidate
>
  <Card.Root>
    <Card.Header>
      <Card.Title>{m.cost_form_basics()}</Card.Title>
    </Card.Header>
    <Card.Content class="flex flex-col gap-5">
      <Field id="cost-title" label={m.cost_title()} error={errors.title}>
        {#snippet children({ describedby, invalid })}
          <Input
            id="cost-title"
            class="h-10"
            required
            maxlength={COST_TITLE_MAX}
            autocomplete="off"
            placeholder={m.cost_title_placeholder()}
            aria-invalid={invalid || undefined}
            aria-describedby={describedby}
            bind:value={draft.title}
          />
        {/snippet}
      </Field>

      <div class="flex flex-col gap-2">
        <span class="text-sm leading-none font-medium">{m.cost_kind()}</span>
        <Segmented
          options={kindOptions}
          bind:value={
            () => (draft.refund ? "refund" : "expense"),
            (value) => (draft.refund = value === "refund")
          }
          label={m.cost_kind()}
        />
        {#if draft.refund}
          <p class="text-muted-foreground text-xs text-pretty">
            {m.cost_kind_refund_hint()}
          </p>
        {/if}
      </div>

      <div class="grid grid-cols-[minmax(0,1fr)_6rem] gap-4">
        <Field
          id="cost-amount"
          label={m.cost_amount()}
          error={errors.amountMinor}
        >
          {#snippet children({ describedby, invalid })}
            <Input
              id="cost-amount"
              class="h-10 text-end tabular-nums"
              type="text"
              inputmode="decimal"
              required
              autocomplete="off"
              placeholder="0.00"
              aria-invalid={invalid || undefined}
              aria-describedby={describedby}
              bind:value={draft.amount}
            />
          {/snippet}
        </Field>
        <Field
          id="cost-currency"
          label={m.cost_currency()}
          error={errors.currency}
        >
          {#snippet children({ describedby, invalid })}
            <Input
              id="cost-currency"
              class="h-10 uppercase"
              maxlength={3}
              autocomplete="off"
              autocapitalize="characters"
              spellcheck={false}
              aria-invalid={invalid || undefined}
              aria-describedby={describedby}
              value={draft.currency}
              oninput={onCurrencyInput}
            />
          {/snippet}
        </Field>
      </div>
      {#if otherCurrency}
        <p
          class="text-muted-foreground -mt-2 text-xs text-pretty"
          aria-live="polite"
        >
          {m.cost_currency_other_hint({ currency })}
        </p>
      {/if}

      <div class="grid gap-5 sm:grid-cols-2">
        <Field id="cost-date" label={m.cost_date()} error={errors.date}>
          {#snippet children({ describedby, invalid })}
            <Input
              id="cost-date"
              class="h-10"
              type="date"
              required
              aria-invalid={invalid || undefined}
              aria-describedby={describedby}
              bind:value={draft.date}
            />
          {/snippet}
        </Field>
        <Field
          id="cost-category"
          label={m.cost_category()}
          error={errors.category}
        >
          {#snippet children({ describedby, invalid })}
            <OptionSelect
              id="cost-category"
              bind:value={draft.category}
              options={categoryOptions}
              onchange={pickCategory}
              {invalid}
              {describedby}
            />
          {/snippet}
        </Field>
      </div>

      <Field
        id="cost-notes"
        label={m.cost_notes()}
        optional
        error={errors.notes}
      >
        {#snippet children({ describedby, invalid })}
          <Textarea
            id="cost-notes"
            rows={3}
            maxlength={COST_NOTES_MAX}
            aria-invalid={invalid || undefined}
            aria-describedby={describedby}
            bind:value={draft.notes}
          />
        {/snippet}
      </Field>
      {#if !entry}
        <p class="text-muted-foreground -mt-2 text-xs text-pretty">
          {m.cost_receipts_after_create()}
        </p>
      {/if}
    </Card.Content>
  </Card.Root>

  <Card.Root>
    <Card.Header>
      <Card.Title>{m.cost_form_links()}</Card.Title>
      <Card.Description>{m.cost_form_links_description()}</Card.Description>
    </Card.Header>
    <Card.Content class="grid gap-5 sm:grid-cols-2">
      <Field id="cost-asset" label={m.cost_asset()} error={errors.assetId}>
        {#snippet children({ describedby, invalid })}
          <OptionSelect
            id="cost-asset"
            bind:value={draft.assetId}
            options={assetOptions}
            onchange={pickAsset}
            {invalid}
            {describedby}
          />
        {/snippet}
      </Field>
      <Field id="cost-room" label={m.cost_room()} error={errors.roomId}>
        {#snippet children({ describedby, invalid })}
          <OptionSelect
            id="cost-room"
            bind:value={draft.roomId}
            options={roomOptions}
            {invalid}
            {describedby}
          />
        {/snippet}
      </Field>
      <Field
        id="cost-defect"
        label={m.cost_defect()}
        hint={m.cost_defect_hint()}
        error={errors.defectId}
      >
        {#snippet children({ describedby, invalid })}
          <OptionSelect
            id="cost-defect"
            bind:value={draft.defectId}
            options={defectOptions}
            {invalid}
            {describedby}
          />
        {/snippet}
      </Field>
      <Field
        id="cost-service"
        label={m.cost_service_entry()}
        hint={serviceLoading ? m.common_loading() : m.cost_service_entry_hint()}
        error={errors.serviceLogId ?? serviceError}
      >
        {#snippet children({ describedby, invalid })}
          <OptionSelect
            id="cost-service"
            bind:value={draft.serviceLogId}
            options={serviceOptions}
            onchange={pickServiceEntry}
            {invalid}
            {describedby}
          />
        {/snippet}
      </Field>
    </Card.Content>
  </Card.Root>

  <Card.Root>
    <Card.Header>
      <Card.Title>{m.cost_form_payment()}</Card.Title>
    </Card.Header>
    <Card.Content class="flex flex-col gap-5">
      <div class="grid gap-5 sm:grid-cols-2">
        <Field
          id="cost-payee"
          label={m.cost_payee()}
          optional
          error={errors.payee}
        >
          {#snippet children({ describedby, invalid })}
            <Input
              id="cost-payee"
              class="h-10"
              maxlength={200}
              autocomplete="off"
              placeholder={m.cost_payee_placeholder()}
              aria-invalid={invalid || undefined}
              aria-describedby={describedby}
              bind:value={draft.payee}
            />
          {/snippet}
        </Field>
        <Field
          id="cost-payer"
          label={m.cost_paid_by()}
          hint={showPayerHint ? m.cost_payer_missing_hint() : undefined}
          error={errors.paidByUserId}
        >
          {#snippet children({ describedby, invalid })}
            <OptionSelect
              id="cost-payer"
              bind:value={draft.paidByUserId}
              options={payerOptions}
              {invalid}
              {describedby}
            />
          {/snippet}
        </Field>
      </div>

      <SplitEditor
        id="cost-split"
        bind:mode={draft.splitMode}
        bind:shares={draft.shares}
        {people}
        amountMinor={amount.ok ? amount.amountMinor : undefined}
        currency={draft.currency}
        error={errors.shares}
      />
      {#if entry && draft.splitMode === entry.splitMode && draft.splitMode !== "custom"}
        <p class="text-muted-foreground -mt-2 text-xs text-pretty">
          {m.cost_split_frozen_hint()}
        </p>
      {/if}

      <SwitchField
        id="cost-counts"
        bind:checked={draft.countsAsExpense}
        label={m.cost_counts_as_expense()}
        hint={m.cost_counts_as_expense_hint()}
        onchange={() => (draft.countsTouched = true)}
      />

      <Field
        id="cost-deductible"
        label={m.cost_deductible()}
        hint={m.cost_deductible_hint()}
        error={errors.deductible}
      >
        {#snippet children({ describedby, invalid })}
          <OptionSelect
            id="cost-deductible"
            bind:value={draft.deductible}
            options={deductibleOptions}
            {invalid}
            {describedby}
          />
        {/snippet}
      </Field>
    </Card.Content>
  </Card.Root>

  <FormAlert message={formError} />

  <div class="flex flex-wrap justify-end gap-2">
    <Button
      href={cancelHref}
      variant="outline"
      size="lg"
      class={pending ? "pointer-events-none opacity-50" : ""}
    >
      {m.common_cancel()}
    </Button>
    <Button type="submit" size="lg" disabled={pending}>
      {#if pending}
        <LoaderCircleIcon class="animate-spin" />{m.common_saving()}
      {:else if entry}
        {m.common_save()}
      {:else}
        {m.common_create()}
      {/if}
    </Button>
  </div>
</form>
