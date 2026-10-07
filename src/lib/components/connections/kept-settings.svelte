<script lang="ts">
  import { untrack } from "svelte";
  import LoaderCircleIcon from "@lucide/svelte/icons/loader-circle";
  import UsersIcon from "@lucide/svelte/icons/users";
  import { toast } from "svelte-sonner";
  import { api } from "$lib/api/browser";
  import { COST_CATEGORIES, type CostCategory } from "$lib/api/enums";
  import { endpoints } from "$lib/api/registry";
  import type { Integration } from "$lib/api/schemas/integrations";
  import FormAlert from "$lib/components/app/form-alert.svelte";
  import SwitchField from "$lib/components/app/switch-field.svelte";
  import OptionSelect from "$lib/components/tasks/option-select.svelte";
  import Field from "$lib/components/tasks/field.svelte";
  import * as Alert from "$lib/components/ui/alert/index.js";
  import { Button } from "$lib/components/ui/button/index.js";
  import { Input } from "$lib/components/ui/input/index.js";
  import { forgetIntegrations } from "$lib/connections/connection";
  import {
    KEPT_LIMITS,
    keptConfigOf,
    keptForbiddenMessage,
    keptPickerErrorMessage,
    readKeptSettings,
    withCreditor,
    withoutCreditor,
    type KeptCategory,
    type KeptSettings,
  } from "$lib/connections/kept";
  import { costCategoryLabel } from "$lib/cost-categories";
  import { apiErrorMessage } from "$lib/error-message";
  import { m } from "$lib/paraglide/messages";
  import KeptCategoryMap from "./kept-category-map.svelte";
  import NameListInput from "./name-list-input.svelte";

  let {
    integration,
    settings = $bindable(),
    dirty,
    refreshKey,
    onchanged,
  }: {
    integration: Integration;
    settings: KeptSettings;
    /** The settings differ from the saved ones. */
    dirty: boolean;
    /** Changes whenever the connection was saved or tested, so the category list is read again. */
    refreshKey: number;
    onchanged: () => Promise<void>;
  } = $props();

  const NONE = "none";

  let saving = $state(false);
  let error = $state<string | undefined>();

  let categories = $state<KeptCategory[] | undefined>();
  let categoriesLoading = $state(false);
  let categoriesError = $state<string | undefined>();
  let loadSeq = 0;

  const billCostOptions = $derived([
    { value: NONE, label: m.integration_kept_bill_cost_none() },
    ...COST_CATEGORIES.map((category) => ({
      value: category,
      label: costCategoryLabel(category),
    })),
  ]);

  async function loadCategories() {
    if (!integration.enabled) {
      loadSeq++;
      categories = undefined;
      categoriesError = undefined;
      categoriesLoading = false;
      return;
    }
    const seq = ++loadSeq;
    categoriesLoading = true;
    categoriesError = undefined;
    try {
      const result = await api.call(endpoints.integrationsCategories, {
        params: { kind: "kept" },
      });
      if (seq !== loadSeq) return;
      categories = result.items;
    } catch (err) {
      if (seq !== loadSeq) return;
      categories = undefined;
      categoriesError = keptPickerErrorMessage(err);
    } finally {
      if (seq === loadSeq) categoriesLoading = false;
    }
  }

  $effect(() => {
    // Read again when the connection was saved or tested, switched on or off, or moved.
    void refreshKey;
    void integration.enabled;
    void integration.baseUrl;
    untrack(() => {
      void loadCategories();
    });
  });

  async function submit(event: SubmitEvent) {
    event.preventDefault();
    if (saving || !dirty) return;
    error = undefined;
    saving = true;
    let saved = false;
    try {
      // The connection itself is not changed here: the stored address and token stay as they are.
      const result = await api.call(endpoints.integrationsSave, {
        params: { kind: "kept" },
        body: {
          baseUrl: integration.baseUrl ?? "",
          allowInsecureTls: integration.allowInsecureTls,
          config: keptConfigOf(settings),
          enabled: integration.enabled,
        },
      });
      settings = readKeptSettings(result.config);
      forgetIntegrations();
      toast.success(m.integration_kept_settings_saved());
      saved = true;
    } catch (err) {
      error =
        keptForbiddenMessage(err, integration.baseUrl ?? "") ??
        apiErrorMessage(err);
    }
    if (saved) await onchanged();
    saving = false;
  }
</script>

<form class="flex flex-col gap-6" onsubmit={submit} novalidate>
  <div class="flex flex-col gap-1">
    <h3 class="text-base font-semibold tracking-tight">
      {m.integration_kept_settings_title()}
    </h3>
    <p class="text-muted-foreground text-sm text-pretty">
      {m.integration_kept_settings_intro()}
    </p>
  </div>

  <FormAlert message={error} />

  <fieldset
    class="m-0 flex min-w-0 flex-col gap-6 border-0 p-0"
    disabled={saving}
  >
    <section class="flex flex-col gap-3">
      <div class="flex flex-col gap-1">
        <h4 class="text-sm font-medium">
          {m.integration_kept_categories_title()}
        </h4>
        <p class="text-muted-foreground text-xs text-pretty">
          {m.integration_kept_categories_hint()}
        </p>
      </div>
      <KeptCategoryMap
        bind:settings
        {categories}
        loading={categoriesLoading}
        error={categoriesError}
        paused={!integration.enabled}
        onretry={loadCategories}
      />
    </section>

    <section class="flex flex-col gap-4">
      <h4 class="text-sm font-medium">{m.integration_kept_bills_title()}</h4>
      <SwitchField
        id="kept-bill-tasks"
        bind:checked={settings.billTasks}
        label={m.integration_kept_bill_tasks()}
        hint={m.integration_kept_bill_tasks_hint()}
      />
      {#if settings.billTasks}
        <Alert.Root class="border-warning/50">
          <UsersIcon class="text-warning" />
          <Alert.Title>
            {m.integration_kept_bill_tasks_consent_title()}
          </Alert.Title>
          <Alert.Description class="text-pretty">
            {m.integration_kept_bill_tasks_consent()}
          </Alert.Description>
        </Alert.Root>
      {/if}

      <Field
        id="kept-bill-cost"
        label={m.integration_kept_bill_cost()}
        hint={m.integration_kept_bill_cost_hint()}
      >
        {#snippet children({ describedby })}
          <OptionSelect
            id="kept-bill-cost"
            value={settings.billCostCategory ?? NONE}
            options={billCostOptions}
            {describedby}
            onchange={(next) =>
              (settings = {
                ...settings,
                billCostCategory: next === NONE ? null : (next as CostCategory),
              })}
          />
        {/snippet}
      </Field>

      {#if settings.billTasks || settings.billCostCategory !== null}
        <Field
          id="kept-creditors"
          label={m.integration_kept_creditors()}
          hint={m.integration_kept_creditors_hint()}
          optional
        >
          {#snippet children({ describedby })}
            <NameListInput
              id="kept-creditors"
              values={settings.billCreditorFilter}
              onadd={(name) => (settings = withCreditor(settings, name))}
              onremove={(name) => (settings = withoutCreditor(settings, name))}
              placeholder={m.integration_kept_creditors_placeholder()}
              emptyText={m.integration_kept_creditors_empty()}
              removeLabel={(name) =>
                m.integration_kept_creditor_remove({ name })}
              maxLength={KEPT_LIMITS.creditorLength}
              full={settings.billCreditorFilter.length >= KEPT_LIMITS.creditors}
              {describedby}
            />
          {/snippet}
        </Field>
      {/if}
    </section>

    <Field
      id="kept-sync-from"
      label={m.integration_kept_sync_from()}
      hint={m.integration_kept_sync_from_hint()}
      optional
    >
      {#snippet children({ describedby })}
        <Input
          id="kept-sync-from"
          type="date"
          class="h-10 sm:max-w-56"
          aria-describedby={describedby}
          bind:value={settings.syncFrom}
        />
      {/snippet}
    </Field>
  </fieldset>

  <div class="flex flex-wrap items-center gap-x-4 gap-y-2">
    <Button type="submit" disabled={saving || !dirty}>
      {#if saving}
        <LoaderCircleIcon class="animate-spin" />{m.common_saving()}
      {:else}
        {m.common_save()}
      {/if}
    </Button>
    {#if dirty && !saving}
      <span class="text-muted-foreground text-xs" aria-live="polite">
        {m.integration_kept_settings_unsaved()}
      </span>
    {/if}
  </div>
</form>
