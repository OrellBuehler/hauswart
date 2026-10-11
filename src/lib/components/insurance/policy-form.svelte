<script lang="ts">
  import BellRingIcon from "@lucide/svelte/icons/bell-ring";
  import CalendarClockIcon from "@lucide/svelte/icons/calendar-clock";
  import LoaderCircleIcon from "@lucide/svelte/icons/loader-circle";
  import { untrack } from "svelte";
  import { goto } from "$app/navigation";
  import { resolve } from "$app/paths";
  import { toast } from "svelte-sonner";
  import { api } from "$lib/api/browser";
  import {
    INSURANCE_PREMIUM_PERIODS,
    INSURANCE_RENEWALS,
    INSURANCE_TYPES,
  } from "$lib/api/enums";
  import { endpoints } from "$lib/api/registry";
  import type { Asset } from "$lib/api/schemas/assets";
  import {
    MAX_NOTICE_MONTHS,
    type InsurancePolicy,
  } from "$lib/api/schemas/insurance";
  import FormAlert from "$lib/components/app/form-alert.svelte";
  import SwitchField from "$lib/components/app/switch-field.svelte";
  import ContactSelect from "$lib/components/contacts/contact-select.svelte";
  import Field from "$lib/components/tasks/field.svelte";
  import OptionSelect from "$lib/components/tasks/option-select.svelte";
  import Segmented from "$lib/components/tasks/segmented.svelte";
  import { Button } from "$lib/components/ui/button/index.js";
  import * as Card from "$lib/components/ui/card/index.js";
  import { Input } from "$lib/components/ui/input/index.js";
  import { Textarea } from "$lib/components/ui/textarea/index.js";
  import { apiErrorMessage } from "$lib/error-message";
  import { formatDateShort, formatRelativeDays } from "$lib/format";
  import { readMoney, formatMoney } from "$lib/format-money";
  import { deadlineInfo, deadlineTones } from "$lib/insurance/deadline";
  import {
    buildCreateBody,
    buildUpdateBody,
    coverableAssets,
    draftDeadline,
    draftFromPolicy,
    newDraft,
    type PolicyDraft,
  } from "$lib/insurance/form";
  import {
    insuranceTypeLabels,
    premiumPeriodLabels,
    renewalLabels,
  } from "$lib/insurance/labels";
  import { annualPremiumMinor } from "$lib/insurance/policy";
  import { insuranceHref } from "$lib/links";
  import { m } from "$lib/paraglide/messages";
  import { apiFieldErrors } from "$lib/tasks/field-errors";
  import { cn } from "$lib/utils";
  import AssetMultiPicker from "./asset-multi-picker.svelte";

  let {
    policy,
    assets,
    currency,
    today,
    defaults = {},
  }: {
    /** The policy to edit; undefined creates a new one. */
    policy?: InsurancePolicy | undefined;
    assets: Asset[];
    /** The household's currency. */
    currency: string;
    today: string;
    defaults?: {
      type?: PolicyDraft["type"] | undefined;
      assetIds?: string[] | undefined;
    };
  } = $props();

  let draft = $state<PolicyDraft>(
    untrack(() =>
      policy
        ? draftFromPolicy(policy)
        : newDraft({ today, currency, ...defaults }),
    ),
  );
  let errors = $state<Record<string, string>>({});
  let formError = $state<string | undefined>();
  let pending = $state(false);
  let formEl = $state<HTMLFormElement | null>(null);

  const items = $derived(coverableAssets(assets, policy));
  const typeOptions = INSURANCE_TYPES.map((type) => ({
    value: type,
    label: insuranceTypeLabels[type](),
  }));
  const periodOptions = INSURANCE_PREMIUM_PERIODS.map((period) => ({
    value: period,
    label: premiumPeriodLabels[period](),
  }));
  const renewalOptions = INSURANCE_RENEWALS.map((renewal) => ({
    value: renewal,
    label: renewalLabels[renewal](),
  }));

  const otherCurrency = $derived(
    /^[A-Z]{3}$/.test(draft.currency) && draft.currency !== currency,
  );
  const annual = $derived.by(() => {
    if (!/^[A-Z]{3}$/.test(draft.currency)) return null;
    const amount = readMoney(draft.premium, draft.currency);
    if (typeof amount !== "number" || amount < 0) return null;
    return annualPremiumMinor(amount, draft.premiumPeriod);
  });
  const deadline = $derived(draftDeadline(draft));
  const deadlineTone = $derived(deadlineInfo(deadline, today));

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
    const built = policy
      ? buildUpdateBody(draft, policy)
      : buildCreateBody(draft);
    errors = built.errors;
    if (!built.body) {
      formError = m.form_check_fields();
      focusFirstError();
      return;
    }
    if (policy && Object.keys(built.body).length === 0) {
      toast.info(m.insurance_form_no_changes());
      await goto(insuranceHref(policy.id));
      return;
    }
    pending = true;
    try {
      const saved = policy
        ? await api.call(endpoints.insurancePoliciesUpdate, {
            params: { id: policy.id },
            body: built.body as never,
          })
        : await api.call(endpoints.insurancePoliciesCreate, {
            body: built.body as never,
          });
      toast.success(
        policy
          ? m.insurance_saved_toast({ title: saved.title })
          : m.insurance_created_toast({ title: saved.title }),
      );
      await goto(insuranceHref(saved.id), { invalidateAll: true });
    } catch (err) {
      errors = apiFieldErrors(err);
      formError = apiErrorMessage(err);
      focusFirstError();
    } finally {
      pending = false;
    }
  }

  const cancelHref = $derived(
    policy ? insuranceHref(policy.id) : resolve("/insurance"),
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
      <Card.Title>{m.insurance_form_basics()}</Card.Title>
    </Card.Header>
    <Card.Content class="flex flex-col gap-5">
      <Field
        id="policy-title"
        label={m.insurance_title_label()}
        error={errors.title}
      >
        {#snippet children({ describedby, invalid })}
          <Input
            id="policy-title"
            class="h-10"
            required
            maxlength={200}
            autocomplete="off"
            placeholder={m.insurance_title_placeholder()}
            aria-invalid={invalid || undefined}
            aria-describedby={describedby}
            bind:value={draft.title}
          />
        {/snippet}
      </Field>
      <div class="grid grid-cols-1 gap-5 sm:grid-cols-2">
        <Field
          id="policy-type"
          label={m.insurance_type_label()}
          error={errors.type}
        >
          {#snippet children({ describedby, invalid })}
            <OptionSelect
              id="policy-type"
              bind:value={draft.type}
              options={typeOptions}
              {invalid}
              {describedby}
            />
          {/snippet}
        </Field>
        <Field
          id="policy-number"
          label={m.insurance_policy_number_label()}
          optional
          error={errors.policyNumber}
        >
          {#snippet children({ describedby, invalid })}
            <Input
              id="policy-number"
              class="h-10"
              maxlength={100}
              autocomplete="off"
              spellcheck={false}
              aria-invalid={invalid || undefined}
              aria-describedby={describedby}
              bind:value={draft.policyNumber}
            />
          {/snippet}
        </Field>
      </div>
      <Field
        id="policy-insurer"
        label={m.insurance_insurer_label()}
        optional
        hint={m.insurance_insurer_hint()}
        error={errors.insurerContactId}
      >
        <ContactSelect
          id="policy-insurer"
          preferKind="insurance"
          bind:value={draft.insurerContactId}
        />
      </Field>
      <a
        href={resolve("/contacts")}
        target="_blank"
        rel="noopener"
        class="text-brand -mt-3 w-fit text-sm font-medium underline underline-offset-4"
        >{m.insurance_insurer_new()}</a
      >
    </Card.Content>
  </Card.Root>

  <Card.Root>
    <Card.Header>
      <Card.Title>{m.insurance_form_cover()}</Card.Title>
      <Card.Description>{m.insurance_assets_hint()}</Card.Description>
    </Card.Header>
    <Card.Content>
      <AssetMultiPicker
        id="policy-assets"
        {items}
        bind:selected={draft.assetIds}
        label={m.insurance_assets_label()}
        emptyText={m.insurance_assets_empty()}
      />
      {#if errors.assetIds}
        <p class="text-destructive mt-2 text-xs text-pretty">
          {errors.assetIds}
        </p>
      {/if}
    </Card.Content>
  </Card.Root>

  <Card.Root>
    <Card.Header>
      <Card.Title>{m.insurance_form_premium()}</Card.Title>
    </Card.Header>
    <Card.Content class="flex flex-col gap-5">
      <div class="grid grid-cols-[minmax(0,1fr)_6rem] gap-4">
        <Field
          id="policy-premium"
          label={m.insurance_premium_label()}
          error={errors.premiumMinor}
        >
          {#snippet children({ describedby, invalid })}
            <Input
              id="policy-premium"
              class="h-10 text-end tabular-nums"
              type="text"
              inputmode="decimal"
              required
              autocomplete="off"
              placeholder="0.00"
              aria-invalid={invalid || undefined}
              aria-describedby={describedby}
              bind:value={draft.premium}
            />
          {/snippet}
        </Field>
        <Field
          id="policy-currency"
          label={m.insurance_currency_label()}
          error={errors.currency}
        >
          {#snippet children({ describedby, invalid })}
            <Input
              id="policy-currency"
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
          {m.insurance_currency_other_hint({ currency })}
        </p>
      {/if}
      <Field
        id="policy-period"
        label={m.insurance_period_label()}
        hint={m.insurance_premium_hint()}
        error={errors.premiumPeriod}
      >
        {#snippet children({ describedby, invalid })}
          <OptionSelect
            id="policy-period"
            bind:value={draft.premiumPeriod}
            options={periodOptions}
            {invalid}
            {describedby}
          />
        {/snippet}
      </Field>
      {#if annual !== null && draft.premiumPeriod !== "annual"}
        <p
          class="text-muted-foreground -mt-2 text-sm tabular-nums"
          aria-live="polite"
        >
          {m.insurance_annual_preview({
            amount: formatMoney(annual, draft.currency),
          })}
        </p>
      {/if}
      <Field
        id="policy-deductible"
        label={m.insurance_deductible_label()}
        optional
        hint={m.insurance_deductible_hint()}
        error={errors.deductibleMinor}
      >
        {#snippet children({ describedby, invalid })}
          <Input
            id="policy-deductible"
            class="h-10 text-end tabular-nums sm:max-w-48"
            type="text"
            inputmode="decimal"
            autocomplete="off"
            placeholder="0.00"
            aria-invalid={invalid || undefined}
            aria-describedby={describedby}
            bind:value={draft.deductible}
          />
        {/snippet}
      </Field>
    </Card.Content>
  </Card.Root>

  <Card.Root>
    <Card.Header>
      <Card.Title>{m.insurance_form_term()}</Card.Title>
    </Card.Header>
    <Card.Content class="flex flex-col gap-5">
      <div class="grid grid-cols-1 gap-5 sm:grid-cols-2">
        <Field
          id="policy-start"
          label={m.insurance_start_label()}
          error={errors.startDate}
        >
          {#snippet children({ describedby, invalid })}
            <Input
              id="policy-start"
              class="h-10"
              type="date"
              required
              aria-invalid={invalid || undefined}
              aria-describedby={describedby}
              bind:value={draft.startDate}
            />
          {/snippet}
        </Field>
        <Field
          id="policy-end"
          label={m.insurance_end_label()}
          optional
          error={errors.endDate}
        >
          {#snippet children({ describedby, invalid })}
            <Input
              id="policy-end"
              class="h-10"
              type="date"
              aria-invalid={invalid || undefined}
              aria-describedby={describedby}
              bind:value={draft.endDate}
            />
          {/snippet}
        </Field>
      </div>
      <p class="text-muted-foreground -mt-2 text-xs text-pretty">
        {m.insurance_end_label_hint()}
      </p>

      <div class="flex flex-col gap-2">
        <span class="text-sm leading-none font-medium"
          >{m.insurance_renewal_label()}</span
        >
        <Segmented
          options={renewalOptions}
          bind:value={draft.renewal}
          label={m.insurance_renewal_label()}
        />
        <p class="text-muted-foreground text-xs text-pretty">
          {m.insurance_renewal_hint()}
        </p>
      </div>

      {#if draft.renewal === "auto"}
        <Field
          id="policy-notice"
          label={m.insurance_notice_label()}
          optional
          hint={m.insurance_notice_hint()}
          error={errors.cancellationNoticeMonths}
        >
          {#snippet children({ describedby, invalid })}
            <Input
              id="policy-notice"
              class="h-10 tabular-nums sm:max-w-32"
              type="text"
              inputmode="numeric"
              maxlength={String(MAX_NOTICE_MONTHS).length}
              autocomplete="off"
              aria-invalid={invalid || undefined}
              aria-describedby={describedby}
              bind:value={draft.noticeMonths}
            />
          {/snippet}
        </Field>
      {/if}

      <div
        class="bg-muted/40 flex items-start gap-3 rounded-lg border p-3"
        aria-live="polite"
      >
        <CalendarClockIcon
          class="text-muted-foreground mt-0.5 size-5 shrink-0"
          aria-hidden="true"
        />
        <div class="flex min-w-0 flex-col gap-1 text-sm">
          <p class="font-medium">{m.insurance_deadline_preview_title()}</p>
          {#if draft.renewal === "fixed"}
            <p class="text-muted-foreground text-pretty">
              {m.insurance_deadline_preview_fixed()}
            </p>
          {:else if deadline && deadlineTone}
            <p
              class={cn(
                "tabular-nums",
                deadlineTone.tone === "ok"
                  ? ""
                  : deadlineTones[deadlineTone.tone],
              )}
            >
              {deadlineTone.tone === "overdue"
                ? m.insurance_deadline_preview_overdue({
                    date: formatDateShort(deadline, { today }),
                  })
                : m.insurance_deadline_preview({
                    date: formatDateShort(deadline, { today }),
                  })}
              <span class="text-muted-foreground font-normal">
                ({formatRelativeDays(deadlineTone.days)})
              </span>
            </p>
            {#if deadlineTone.tone !== "overdue"}
              <p
                class="text-muted-foreground flex items-center gap-1.5 text-xs"
              >
                <BellRingIcon class="size-3.5 shrink-0" aria-hidden="true" />
                {m.insurance_deadline_preview_reminder()}
              </p>
            {/if}
          {:else}
            <p class="text-muted-foreground text-pretty">
              {m.insurance_deadline_preview_missing()}
            </p>
          {/if}
        </div>
      </div>
    </Card.Content>
  </Card.Root>

  <Card.Root>
    <Card.Header>
      <Card.Title>{m.insurance_form_help()}</Card.Title>
    </Card.Header>
    <Card.Content class="flex flex-col gap-5">
      <Field
        id="policy-assistance"
        label={m.insurance_assistance_label()}
        optional
        hint={m.insurance_assistance_hint()}
        error={errors.assistancePhone}
      >
        {#snippet children({ describedby, invalid })}
          <Input
            id="policy-assistance"
            class="h-10"
            type="tel"
            maxlength={60}
            autocomplete="off"
            placeholder="+41 00 000 00 00"
            aria-invalid={invalid || undefined}
            aria-describedby={describedby}
            bind:value={draft.assistancePhone}
          />
        {/snippet}
      </Field>
      <SwitchField
        id="policy-emergency"
        bind:checked={draft.showOnEmergency}
        label={m.insurance_emergency_label()}
        hint={m.insurance_emergency_hint()}
      />
    </Card.Content>
  </Card.Root>

  <Card.Root>
    <Card.Header>
      <Card.Title>{m.insurance_form_more()}</Card.Title>
    </Card.Header>
    <Card.Content class="flex flex-col gap-3">
      <Field
        id="policy-notes"
        label={m.insurance_notes_label()}
        optional
        error={errors.notes}
      >
        {#snippet children({ describedby, invalid })}
          <Textarea
            id="policy-notes"
            rows={4}
            maxlength={10000}
            aria-invalid={invalid || undefined}
            aria-describedby={describedby}
            bind:value={draft.notes}
          />
        {/snippet}
      </Field>
      {#if !policy}
        <p class="text-muted-foreground text-xs text-pretty">
          {m.insurance_files_after_create()}
        </p>
      {/if}
    </Card.Content>
  </Card.Root>

  <div
    class="bg-background/90 sticky bottom-0 z-10 -mx-4 flex flex-col gap-3 border-t px-4 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] backdrop-blur md:-mx-8 md:px-8"
  >
    <FormAlert message={formError} />
    <div class="flex justify-end gap-2">
      <Button
        href={cancelHref}
        variant="outline"
        size="lg"
        class={cn(
          "flex-1 sm:flex-none",
          pending && "pointer-events-none opacity-50",
        )}
      >
        {m.common_cancel()}
      </Button>
      <Button
        type="submit"
        size="lg"
        class="flex-1 sm:flex-none"
        disabled={pending}
      >
        {#if pending}
          <LoaderCircleIcon class="animate-spin" />{m.common_saving()}
        {:else if policy}
          {m.common_save()}
        {:else}
          {m.common_create()}
        {/if}
      </Button>
    </div>
  </div>
</form>
