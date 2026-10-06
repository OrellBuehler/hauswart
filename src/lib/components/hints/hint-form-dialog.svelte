<script lang="ts">
  import { toast } from "svelte-sonner";
  import { api } from "$lib/api/browser";
  import { HINT_KINDS, type HintKind } from "$lib/api/enums";
  import { endpoints } from "$lib/api/registry";
  import type { Hint, SignalReaction } from "$lib/api/schemas/hints";
  import { MAX_REACTION_DELAY_MINUTES } from "$lib/api/schemas/hints";
  import EntityPicker from "$lib/components/connections/entity-picker.svelte";
  import FormDialog from "$lib/components/app/form-dialog.svelte";
  import SwitchField from "$lib/components/app/switch-field.svelte";
  import Field from "$lib/components/tasks/field.svelte";
  import NumberField from "$lib/components/tasks/number-field.svelte";
  import Segmented from "$lib/components/tasks/segmented.svelte";
  import { Button } from "$lib/components/ui/button/index.js";
  import { Input } from "$lib/components/ui/input/index.js";
  import { Textarea } from "$lib/components/ui/textarea/index.js";
  import { apiErrorMessage } from "$lib/error-message";
  import { commonStates } from "$lib/connections/entities";
  import type { ExternalEntity } from "$lib/connections/types";
  import { hintKindLabels } from "$lib/hints/labels";
  import { m } from "$lib/paraglide/messages";
  import { apiFieldErrors } from "$lib/tasks/field-errors";

  type NotifyChoice = "all" | "assignee" | "custom";

  let {
    open = $bindable(false),
    assetId,
    hint,
    onsaved,
  }: {
    open?: boolean;
    assetId: string;
    /** The hint to edit; undefined adds a new one. */
    hint?: Hint | undefined;
    onsaved: (hint: Hint) => void | Promise<void>;
  } = $props();

  let kind = $state<HintKind>("tip");
  let title = $state("");
  let bodyMd = $state("");
  let pinned = $state(false);
  let guestVisible = $state(false);
  let reactionOpen = $state(false);
  let entityId = $state("");
  let fromState = $state("");
  let toState = $state("");
  let delayMinutes = $state<number | undefined>(undefined);
  let notify = $state<NotifyChoice>("all");
  let customNotify = $state<string[]>([]);
  let fieldErrors = $state<Record<string, string>>({});
  let resolved = $state<ExternalEntity | null | undefined>();

  const editing = $derived(hint !== undefined);
  const kindOptions = HINT_KINDS.map((value) => ({
    value,
    label: hintKindLabels[value](),
  }));
  const stateChips = $derived.by(() => {
    const chips = commonStates(entityId.split(".")[0] ?? "");
    const current = resolved?.state;
    if (
      current &&
      !chips.includes(current) &&
      Number.isNaN(Number(current)) &&
      current !== "unavailable" &&
      current !== "unknown"
    ) {
      chips.push(current);
    }
    return chips;
  });
  const notifyOptions = $derived([
    { value: "all" as NotifyChoice, label: m.hint_reaction_notify_all() },
    {
      value: "assignee" as NotifyChoice,
      label: m.hint_reaction_notify_assignee(),
    },
    ...(customNotify.length > 0
      ? [
          {
            value: "custom" as NotifyChoice,
            label: m.hint_reaction_notify_custom(),
          },
        ]
      : []),
  ]);

  $effect(() => {
    if (!open) return;
    kind = hint?.kind ?? "tip";
    title = hint?.title ?? "";
    bodyMd = hint?.bodyMd ?? "";
    pinned = hint?.pinned ?? false;
    guestVisible = hint?.guestVisible ?? false;
    const reaction = hint?.reaction ?? null;
    reactionOpen = reaction !== null;
    entityId = reaction?.entityId ?? "";
    fromState = reaction?.fromState ?? "";
    toState = reaction?.toState ?? "";
    delayMinutes = reaction?.delayMinutes;
    customNotify = Array.isArray(reaction?.notify) ? reaction.notify : [];
    notify = Array.isArray(reaction?.notify)
      ? "custom"
      : (reaction?.notify ?? "all");
    fieldErrors = {};
  });

  function buildReaction(): SignalReaction | null | undefined {
    const entity = entityId.trim();
    const to = toState.trim();
    const from = fromState.trim();
    if (!entity && !to && !from && delayMinutes === undefined) return null;
    const errors: Record<string, string> = {};
    if (!entity) errors.entityId = m.field_required();
    if (!to) errors.toState = m.field_required();
    if (
      delayMinutes !== undefined &&
      (!Number.isInteger(delayMinutes) ||
        delayMinutes < 0 ||
        delayMinutes > MAX_REACTION_DELAY_MINUTES)
    ) {
      errors.delayMinutes = m.field_max({ max: MAX_REACTION_DELAY_MINUTES });
    }
    if (Object.keys(errors).length > 0) {
      fieldErrors = { ...fieldErrors, ...errors };
      reactionOpen = true;
      return undefined;
    }
    return {
      type: "signal_change",
      entityId: entity,
      toState: to,
      ...(from ? { fromState: from } : {}),
      ...(delayMinutes !== undefined ? { delayMinutes } : {}),
      notify:
        notify === "custom" && customNotify.length > 0
          ? customNotify
          : notify === "assignee"
            ? "assignee"
            : "all",
    };
  }

  async function submit(): Promise<string | void> {
    fieldErrors = {};
    const problems: Record<string, string> = {};
    if (!title.trim()) problems.title = m.field_required();
    const reaction = buildReaction();
    if (Object.keys(problems).length > 0 || reaction === undefined) {
      fieldErrors = { ...fieldErrors, ...problems };
      return m.form_check_fields();
    }
    const fields = { title, bodyMd, kind, pinned, guestVisible, reaction };
    try {
      const saved = hint
        ? await api.call(endpoints.hintsUpdate, {
            params: { id: hint.id },
            body: fields,
          })
        : await api.call(endpoints.assetHintsCreate, {
            params: { id: assetId },
            body: fields,
          });
      toast.success(
        editing
          ? m.hint_saved_toast({ title: saved.title })
          : m.hint_created_toast({ title: saved.title }),
      );
      await onsaved(saved);
    } catch (err) {
      fieldErrors = apiFieldErrors(err);
      if (Object.keys(fieldErrors).length > 0) return m.form_check_fields();
      return apiErrorMessage(err);
    }
  }
</script>

<FormDialog
  bind:open
  title={editing ? m.hint_edit_title() : m.hint_create_title()}
  description={m.hint_form_description()}
  submitLabel={editing ? m.common_save() : m.common_create()}
  pendingLabel={editing ? m.common_saving() : m.common_creating()}
  onsubmit={submit}
>
  <div class="flex flex-col gap-2">
    <span class="text-sm leading-none font-medium" id="hint-kind-label">
      {m.hint_kind()}
    </span>
    <Segmented
      options={kindOptions}
      bind:value={kind}
      label={m.hint_kind()}
      class="w-full [&>button]:flex-1"
    />
  </div>
  <Field id="hint-title" label={m.hint_title()} error={fieldErrors.title}>
    {#snippet children({ describedby, invalid })}
      <Input
        id="hint-title"
        autocomplete="off"
        maxlength={200}
        placeholder={m.hint_title_placeholder()}
        aria-invalid={invalid || undefined}
        aria-describedby={describedby}
        class="h-10"
        bind:value={title}
      />
    {/snippet}
  </Field>
  <Field
    id="hint-body"
    label={m.hint_body()}
    optional
    error={fieldErrors.bodyMd}
  >
    {#snippet children({ describedby, invalid })}
      <Textarea
        id="hint-body"
        rows={4}
        maxlength={10000}
        aria-invalid={invalid || undefined}
        aria-describedby={describedby}
        bind:value={bodyMd}
      />
    {/snippet}
  </Field>
  <div class="flex flex-col gap-4">
    <SwitchField
      id="hint-pinned"
      bind:checked={pinned}
      label={m.hint_pinned()}
      hint={m.hint_pinned_hint()}
    />
    <SwitchField
      id="hint-guest"
      bind:checked={guestVisible}
      label={m.hint_guest_visible()}
      hint={m.hint_guest_visible_hint()}
    />
  </div>
  <details class="group rounded-lg border px-3 py-2" bind:open={reactionOpen}>
    <summary
      class="text-muted-foreground focus-visible:ring-ring/50 min-h-8 cursor-pointer rounded text-sm font-medium outline-none select-none focus-visible:ring-[3px]"
    >
      {m.hint_reaction_title()}
    </summary>
    <div class="mt-3 flex flex-col gap-4 pb-1">
      <p
        class="bg-muted text-muted-foreground rounded-md px-3 py-2 text-xs text-pretty"
      >
        {m.hint_reaction_note()}
      </p>
      <Field
        id="hint-entity"
        label={m.hint_reaction_entity()}
        hint={m.hint_reaction_entity_hint()}
        error={fieldErrors.entityId}
      >
        {#snippet children({ describedby, invalid })}
          <EntityPicker
            id="hint-entity"
            bind:value={entityId}
            placeholder="binary_sensor.example_door"
            {invalid}
            {describedby}
            onresolve={(entity) => (resolved = entity)}
          />
        {/snippet}
      </Field>
      <div class="grid gap-4 sm:grid-cols-2">
        <Field
          id="hint-from"
          label={m.hint_reaction_from()}
          optional
          error={fieldErrors.fromState}
        >
          {#snippet children({ describedby, invalid })}
            <Input
              id="hint-from"
              autocomplete="off"
              autocapitalize="none"
              spellcheck={false}
              maxlength={255}
              placeholder="on"
              aria-invalid={invalid || undefined}
              aria-describedby={describedby}
              class="h-10"
              bind:value={fromState}
            />
            {#if stateChips.length > 0}
              <div
                class="flex flex-wrap items-center gap-1.5"
                role="group"
                aria-label={m.trigger_form_value_suggestions()}
              >
                {#each stateChips as chip (chip)}
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    class="h-8 font-mono text-xs"
                    onclick={() => (fromState = chip)}
                  >
                    {chip}
                  </Button>
                {/each}
              </div>
            {/if}
          {/snippet}
        </Field>
        <Field
          id="hint-to"
          label={m.hint_reaction_to()}
          error={fieldErrors.toState}
        >
          {#snippet children({ describedby, invalid })}
            <Input
              id="hint-to"
              autocomplete="off"
              autocapitalize="none"
              spellcheck={false}
              maxlength={255}
              placeholder="off"
              aria-invalid={invalid || undefined}
              aria-describedby={describedby}
              class="h-10"
              bind:value={toState}
            />
            {#if stateChips.length > 0}
              <div
                class="flex flex-wrap items-center gap-1.5"
                role="group"
                aria-label={m.trigger_form_value_suggestions()}
              >
                {#each stateChips as chip (chip)}
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    class="h-8 font-mono text-xs"
                    onclick={() => (toState = chip)}
                  >
                    {chip}
                  </Button>
                {/each}
              </div>
            {/if}
          {/snippet}
        </Field>
      </div>
      <Field
        id="hint-delay"
        label={m.hint_reaction_delay()}
        optional
        hint={m.hint_reaction_delay_hint({ max: MAX_REACTION_DELAY_MINUTES })}
        error={fieldErrors.delayMinutes}
      >
        {#snippet children({ describedby, invalid })}
          <NumberField
            id="hint-delay"
            bind:value={delayMinutes}
            placeholder="0"
            {invalid}
            {describedby}
          />
        {/snippet}
      </Field>
      <div class="flex flex-col gap-2">
        <span class="text-sm leading-none font-medium">
          {m.hint_reaction_notify()}
        </span>
        <Segmented
          options={notifyOptions}
          bind:value={notify}
          label={m.hint_reaction_notify()}
        />
      </div>
    </div>
  </details>
</FormDialog>
