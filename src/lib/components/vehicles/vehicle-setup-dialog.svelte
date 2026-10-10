<script lang="ts">
  import CheckIcon from "@lucide/svelte/icons/check";
  import LoaderCircleIcon from "@lucide/svelte/icons/loader-circle";
  import TriangleAlertIcon from "@lucide/svelte/icons/triangle-alert";
  import { untrack } from "svelte";
  import { toast } from "svelte-sonner";
  import { api } from "$lib/api/browser";
  import type { OdometerUnit } from "$lib/api/enums";
  import { endpoints } from "$lib/api/registry";
  import type { Task } from "$lib/api/schemas/tasks";
  import FormDialog from "$lib/components/app/form-dialog.svelte";
  import Field from "$lib/components/tasks/field.svelte";
  import OptionSelect from "$lib/components/tasks/option-select.svelte";
  import { Badge } from "$lib/components/ui/badge/index.js";
  import { Checkbox } from "$lib/components/ui/checkbox/index.js";
  import { Input } from "$lib/components/ui/input/index.js";
  import { Label } from "$lib/components/ui/label/index.js";
  import { apiErrorMessage } from "$lib/error-message";
  import { monthName } from "$lib/format";
  import { m } from "$lib/paraglide/messages";
  import { getLocale } from "$lib/paraglide/runtime";
  import { describeTrigger } from "$lib/tasks/describe";
  import {
    DEFAULT_SELECTED,
    SETUP_TEMPLATE_IDS,
    buildTemplate,
    createTemplates,
    defaultParams,
    findExistingTask,
    type SetupContext,
    type SetupParams,
    type TemplateRun,
  } from "$lib/vehicles/setup";
  import type { VehicleTemplateId } from "$lib/vehicles/templates";
  import { cn } from "$lib/utils";

  let {
    open = $bindable(false),
    assetId,
    assetName,
    firstRegistration,
    unit,
    today,
    tasks,
    onfinished,
  }: {
    open?: boolean;
    assetId: string;
    assetName: string;
    firstRegistration: string | null;
    unit: OdometerUnit;
    today: string;
    /** The tasks of the vehicle, to leave out what it has already. */
    tasks: Task[];
    /** Some tasks were created: the page reloads what it shows. */
    onfinished: () => void | Promise<void>;
  } = $props();

  const ctx = $derived<SetupContext>({
    assetId,
    firstRegistration,
    today,
    odometerUnit: unit,
  });

  const titleOf: Record<VehicleTemplateId, () => string> = {
    tires_winter: () => m.vehicle_task_tires_winter_title(),
    tires_summer: () => m.vehicle_task_tires_summer_title(),
    service: () => m.vehicle_task_service_title(),
    mfk: () => m.vehicle_task_mfk_title(),
    vignette: () => m.vehicle_task_vignette_title(),
    vehicle_tax: () => m.vehicle_task_tax_title(),
    brake_fluid: () => m.vehicle_task_brake_fluid_title(),
    ac_service: () => m.vehicle_task_ac_service_title(),
  };

  let selected = $state<Record<string, boolean>>({});
  let params = $state<SetupParams>(untrack(() => defaultParams(ctx)));
  let errors = $state<Record<string, string>>({});
  let runs = $state<Record<string, TemplateRun>>({});

  const existing = $derived(
    new Map(
      SETUP_TEMPLATE_IDS.map(
        (id) => [id, findExistingTask(id, tasks, assetId)] as const,
      ),
    ),
  );
  const built = $derived(
    new Map(
      SETUP_TEMPLATE_IDS.map(
        (id) => [id, buildTemplate(id, ctx, params).template] as const,
      ),
    ),
  );
  const offered = $derived(
    SETUP_TEMPLATE_IDS.filter(
      (id) => !existing.get(id) && runs[id]?.state !== "created",
    ),
  );

  $effect(() => {
    if (!open) return;
    const fresh = defaultParams(ctx);
    params = fresh;
    errors = {};
    runs = {};
    selected = Object.fromEntries(
      SETUP_TEMPLATE_IDS.map((id) => [
        id,
        DEFAULT_SELECTED.includes(id) &&
          !existing.get(id) &&
          // without a first registration there is no date to suggest: the person opts in
          (id !== "mfk" || fresh.mfkDate !== ""),
      ]),
    );
  });

  const monthOptions = $derived(
    Array.from({ length: 12 }, (_, i) => ({
      value: String(i + 1),
      label: monthName(i + 1),
    })),
  );

  function summary(id: VehicleTemplateId): string | null {
    const template = built.get(id);
    return template
      ? describeTrigger(template.task.trigger, getLocale())
      : null;
  }

  async function submit(): Promise<string | void> {
    const chosen = offered.filter((id) => selected[id]);
    if (chosen.length === 0) return m.vehicle_setup_none_selected();

    const templates = [];
    const found: Record<string, string> = {};
    for (const id of chosen) {
      const result = buildTemplate(id, ctx, params);
      Object.assign(found, result.errors);
      if (result.template) templates.push(result.template);
    }
    errors = found;
    if (Object.keys(found).length > 0) return m.form_check_fields();

    const results = await createTemplates(
      templates,
      {
        createTask: (body) => api.call(endpoints.tasksCreate, { body }),
        createPreparation: (taskId, body) =>
          api.call(endpoints.preparationsCreate, {
            params: { id: taskId },
            body,
          }),
      },
      (run) => {
        runs = { ...runs, [run.id]: run };
      },
      apiErrorMessage,
    );
    const created = results.filter((run) => run.state === "created");
    for (const run of created) selected[run.id] = false;
    if (created.length > 0) {
      toast.success(m.vehicle_setup_done_toast({ count: created.length }));
      await onfinished();
    }
    if (results.some((run) => run.state === "failed")) {
      return m.vehicle_setup_partial_error();
    }
  }
</script>

<FormDialog
  bind:open
  class="sm:max-w-2xl"
  title={m.vehicle_setup_title()}
  description={m.vehicle_setup_description({ name: assetName })}
  submitLabel={m.vehicle_setup_submit()}
  pendingLabel={m.vehicle_setup_pending()}
  onsubmit={submit}
>
  <ul class="flex flex-col gap-3">
    {#each SETUP_TEMPLATE_IDS as id (id)}
      {@const found = existing.get(id)}
      {@const run = runs[id]}
      {@const locked = Boolean(found) || run?.state === "created"}
      {@const template = built.get(id)}
      <li
        class={cn(
          "flex flex-col gap-3 rounded-lg border p-3",
          locked && "bg-muted/40",
        )}
      >
        <div class="flex items-start gap-3">
          <Checkbox
            id={`setup-${id}`}
            class="mt-0.5"
            disabled={locked || run?.state === "running"}
            checked={Boolean(selected[id]) && !locked}
            onCheckedChange={(on) => (selected[id] = on)}
          />
          <div class="min-w-0 flex-1">
            <div class="flex flex-wrap items-center gap-x-2 gap-y-1">
              <Label
                for={`setup-${id}`}
                class="min-w-0 text-sm leading-snug wrap-anywhere"
              >
                {titleOf[id]()}
              </Label>
              {#if found}
                <Badge variant="secondary">{m.vehicle_setup_exists()}</Badge>
              {:else if run?.state === "created"}
                <Badge variant="secondary" class="gap-1">
                  <CheckIcon aria-hidden="true" />{m.vehicle_setup_created()}
                </Badge>
              {:else if run?.state === "running"}
                <Badge variant="secondary" class="gap-1">
                  <LoaderCircleIcon class="animate-spin" aria-hidden="true" />
                  {m.vehicle_setup_running()}
                </Badge>
              {/if}
            </div>
            {#if found}
              <p class="text-muted-foreground mt-0.5 text-xs text-pretty">
                {m.vehicle_setup_exists_hint({ title: found.title })}
              </p>
            {:else}
              {@const text = summary(id)}
              {#if text}
                <p class="text-muted-foreground mt-0.5 text-xs text-pretty">
                  {text}
                </p>
              {/if}
              {#each template?.preparations ?? [] as preparation (preparation.title)}
                <p class="text-muted-foreground mt-0.5 text-xs text-pretty">
                  {m.vehicle_setup_prep({
                    title: preparation.title,
                    days: preparation.leadDays ?? 0,
                  })}
                </p>
              {/each}
            {/if}
            {#if run?.state === "failed" && run.error}
              <p
                class="text-destructive mt-1.5 flex items-start gap-1.5 text-xs text-pretty"
                role="alert"
              >
                <TriangleAlertIcon
                  class="mt-0.5 size-3.5 shrink-0"
                  aria-hidden="true"
                />
                {run.error}
              </p>
            {/if}
            {#each run?.preparationErrors ?? [] as problem (problem.title)}
              <p
                class="text-warning mt-1.5 flex items-start gap-1.5 text-xs text-pretty"
                role="alert"
              >
                <TriangleAlertIcon
                  class="mt-0.5 size-3.5 shrink-0"
                  aria-hidden="true"
                />
                {m.vehicle_setup_prep_failed({
                  title: problem.title,
                  error: problem.error,
                })}
              </p>
            {/each}
          </div>
        </div>

        {#if selected[id] && !locked}
          {#if id === "service"}
            <div class="grid grid-cols-1 gap-4 ps-8 sm:grid-cols-2">
              <Field
                id="setup-service-distance"
                label={m.vehicle_setup_service_distance({ unit })}
                error={errors.serviceDistance}
              >
                {#snippet children({ describedby, invalid })}
                  <Input
                    id="setup-service-distance"
                    class="h-10 tabular-nums"
                    type="text"
                    inputmode="decimal"
                    autocomplete="off"
                    aria-invalid={invalid || undefined}
                    aria-describedby={describedby}
                    bind:value={params.serviceDistance}
                  />
                {/snippet}
              </Field>
              <Field
                id="setup-service-months"
                label={m.vehicle_setup_service_months()}
                error={errors.serviceMonths}
              >
                {#snippet children({ describedby, invalid })}
                  <Input
                    id="setup-service-months"
                    class="h-10 tabular-nums"
                    type="text"
                    inputmode="numeric"
                    autocomplete="off"
                    aria-invalid={invalid || undefined}
                    aria-describedby={describedby}
                    bind:value={params.serviceMonths}
                  />
                {/snippet}
              </Field>
            </div>
          {:else if id === "mfk"}
            <div class="ps-8">
              <Field
                id="setup-mfk-date"
                label={m.vehicle_setup_mfk_date()}
                hint={firstRegistration
                  ? m.vehicle_setup_mfk_hint()
                  : m.vehicle_setup_mfk_unknown()}
                error={errors.mfkDate}
              >
                {#snippet children({ describedby, invalid })}
                  <Input
                    id="setup-mfk-date"
                    class="h-10 sm:max-w-56"
                    type="date"
                    aria-invalid={invalid || undefined}
                    aria-describedby={describedby}
                    bind:value={params.mfkDate}
                  />
                {/snippet}
              </Field>
            </div>
          {:else if id === "vehicle_tax"}
            <div class="flex flex-col gap-2 ps-8">
              <div
                class="grid grid-cols-[minmax(0,1fr)_5rem] gap-4 sm:max-w-sm"
              >
                <Field
                  id="setup-tax-month"
                  label={m.vehicle_setup_month()}
                  error={errors.taxMonth}
                >
                  {#snippet children({ describedby, invalid })}
                    <OptionSelect
                      id="setup-tax-month"
                      bind:value={params.taxMonth}
                      options={monthOptions}
                      {invalid}
                      {describedby}
                    />
                  {/snippet}
                </Field>
                <Field
                  id="setup-tax-day"
                  label={m.vehicle_setup_day()}
                  error={errors.taxDay}
                >
                  {#snippet children({ describedby, invalid })}
                    <Input
                      id="setup-tax-day"
                      class="h-10 tabular-nums"
                      type="text"
                      inputmode="numeric"
                      autocomplete="off"
                      maxlength={2}
                      aria-invalid={invalid || undefined}
                      aria-describedby={describedby}
                      bind:value={params.taxDay}
                    />
                  {/snippet}
                </Field>
              </div>
              <p class="text-muted-foreground text-xs text-pretty">
                {m.vehicle_setup_tax_hint()}
              </p>
            </div>
          {:else if id === "brake_fluid" || id === "ac_service"}
            {@const field =
              id === "brake_fluid" ? "brakeFluidLastDone" : "acServiceLastDone"}
            <div class="ps-8">
              <Field
                id={`setup-${id}-last`}
                label={m.vehicle_setup_last_done()}
                optional
                hint={m.vehicle_setup_last_done_hint()}
                error={errors[field]}
              >
                {#snippet children({ describedby, invalid })}
                  <Input
                    id={`setup-${id}-last`}
                    class="h-10 sm:max-w-56"
                    type="date"
                    max={today}
                    aria-invalid={invalid || undefined}
                    aria-describedby={describedby}
                    bind:value={params[field]}
                  />
                {/snippet}
              </Field>
            </div>
          {/if}
        {/if}
      </li>
    {/each}
  </ul>
  {#if offered.length === 0}
    <p class="text-muted-foreground text-sm text-pretty">
      {m.vehicle_setup_nothing_left()}
    </p>
  {/if}
</FormDialog>
