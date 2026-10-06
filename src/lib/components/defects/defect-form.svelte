<script lang="ts">
  import LoaderCircleIcon from "@lucide/svelte/icons/loader-circle";
  import { untrack } from "svelte";
  import { goto } from "$app/navigation";
  import { resolve } from "$app/paths";
  import { toast } from "svelte-sonner";
  import { api } from "$lib/api/browser";
  import { DEFECT_SEVERITIES, type DefectSeverity } from "$lib/api/enums";
  import { endpoints } from "$lib/api/registry";
  import type { Asset } from "$lib/api/schemas/assets";
  import type { Contact } from "$lib/api/schemas/contacts";
  import {
    createDefectRequestSchema,
    updateDefectRequestSchema,
    type CreateDefectRequest,
    type Defect,
    type UpdateDefectRequest,
  } from "$lib/api/schemas/defects";
  import type { Room } from "$lib/api/schemas/rooms";
  import FormAlert from "$lib/components/app/form-alert.svelte";
  import Field from "$lib/components/tasks/field.svelte";
  import OptionSelect from "$lib/components/tasks/option-select.svelte";
  import Segmented from "$lib/components/tasks/segmented.svelte";
  import { Button } from "$lib/components/ui/button/index.js";
  import * as Card from "$lib/components/ui/card/index.js";
  import { Input } from "$lib/components/ui/input/index.js";
  import { Textarea } from "$lib/components/ui/textarea/index.js";
  import { addMonths } from "$lib/dates";
  import { severityLabels } from "$lib/defects/labels";
  import { apiErrorMessage } from "$lib/error-message";
  import { formatDay } from "$lib/format";
  import { m } from "$lib/paraglide/messages";
  import { apiFieldErrors, issuesToErrors } from "$lib/tasks/field-errors";

  type DeadlineMode = "auto" | "manual" | "none";

  let {
    defect,
    rooms,
    assets,
    contacts,
    today,
    handoverDate,
    deadlineMonths,
    defaults = {},
  }: {
    defect?: Defect | undefined;
    rooms: Room[];
    assets: Asset[];
    contacts: Contact[];
    today: string;
    /** The household's handover date; without one there is no automatic deadline. */
    handoverDate: string | null;
    deadlineMonths: number;
    defaults?: { assetId?: string | undefined; roomId?: string | undefined };
  } = $props();

  const init = untrack(() => {
    const mode: DeadlineMode = defect
      ? defect.deadlineSource === "handover" && handoverDate
        ? "auto"
        : defect.deadlineDate
          ? "manual"
          : "none"
      : handoverDate
        ? "auto"
        : "none";
    return {
      title: defect?.title ?? "",
      description: defect?.descriptionMd ?? "",
      severity: (defect?.severity ?? "medium") as DefectSeverity,
      roomId: defect ? (defect.roomId ?? "") : (defaults.roomId ?? ""),
      assetId: defect ? (defect.assetId ?? "") : (defaults.assetId ?? ""),
      locationDetail: defect?.locationDetail ?? "",
      discoveredOn: defect?.discoveredOn ?? today,
      contactId: defect?.responsibleContactId ?? "",
      mode,
      deadlineDate: defect?.deadlineDate ?? "",
    };
  });

  let title = $state(init.title);
  let description = $state(init.description);
  let severity = $state<DefectSeverity>(init.severity);
  let roomId = $state(init.roomId);
  let assetId = $state(init.assetId);
  let locationDetail = $state(init.locationDetail);
  let discoveredOn = $state(init.discoveredOn);
  let contactId = $state(init.contactId);
  let mode = $state<DeadlineMode>(init.mode);
  let deadlineDate = $state(init.deadlineDate);

  let errors = $state<Record<string, string>>({});
  let formError = $state<string | undefined>();
  let pending = $state(false);
  let formEl = $state<HTMLFormElement | null>(null);

  const autoDate = $derived(
    handoverDate ? addMonths(handoverDate, deadlineMonths) : null,
  );
  const severityOptions = $derived(
    DEFECT_SEVERITIES.map((s) => ({ value: s, label: severityLabels[s]() })),
  );
  const modeOptions = $derived([
    ...(handoverDate
      ? [{ value: "auto" as const, label: m.defect_deadline_auto() }]
      : []),
    { value: "manual" as const, label: m.defect_deadline_manual() },
    { value: "none" as const, label: m.defect_deadline_none_option() },
  ]);
  const roomOptions = $derived([
    { value: "", label: m.defect_no_room() },
    ...rooms.map((r) => ({ value: r.id, label: r.name })),
  ]);
  const assetOptions = $derived([
    { value: "", label: m.defect_no_asset() },
    ...assets.map((a) => ({
      value: a.id,
      label: a.roomName ? `${a.name} (${a.roomName})` : a.name,
    })),
  ]);
  const contactOptions = $derived([
    { value: "", label: m.defect_no_contact() },
    ...contacts.map((c) => ({
      value: c.id,
      label: c.company ? `${c.name} (${c.company})` : c.name,
    })),
  ]);

  function pickAsset(next: string) {
    if (!next || roomId) return;
    const room = assets.find((a) => a.id === next)?.roomId;
    if (room) roomId = room;
  }

  function requestBody() {
    const base = {
      title: title.trim(),
      descriptionMd: description,
      severity,
      roomId: roomId || null,
      assetId: assetId || null,
      locationDetail,
      discoveredOn,
      responsibleContactId: contactId || null,
    };
    if (defect) {
      return mode === "auto"
        ? { ...base, deadlineSource: "handover" as const }
        : { ...base, deadlineDate: mode === "manual" ? deadlineDate : null };
    }
    return mode === "auto"
      ? base
      : { ...base, deadlineDate: mode === "manual" ? deadlineDate : null };
  }

  function validate(body: ReturnType<typeof requestBody>) {
    const result = (
      defect ? updateDefectRequestSchema : createDefectRequestSchema
    ).safeParse(body);
    const found = result.success
      ? {}
      : issuesToErrors(result.error.issues, body);
    if (mode === "manual" && !deadlineDate) {
      found.deadlineDate = m.field_required();
    }
    return Object.keys(found).length === 0 && result.success
      ? { data: result.data, errors: found }
      : { data: undefined, errors: found };
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
    const body = requestBody();
    const { data, errors: found } = validate(body);
    errors = found;
    if (!data) {
      formError = m.defect_form_fix_errors();
      focusFirstError();
      return;
    }
    pending = true;
    try {
      const saved = defect
        ? await api.call(endpoints.defectsUpdate, {
            params: { id: defect.id },
            body: data as UpdateDefectRequest,
          })
        : await api.call(endpoints.defectsCreate, {
            body: data as CreateDefectRequest,
          });
      toast.success(
        defect
          ? m.defect_saved_toast({ number: saved.number })
          : m.defect_created_toast({ number: saved.number }),
      );
      await goto(resolve(`/defects/${saved.id}` as "/"), {
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
    defect ? resolve(`/defects/${defect.id}` as "/") : resolve("/defects"),
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
      <Card.Title>{m.defect_form_basics()}</Card.Title>
    </Card.Header>
    <Card.Content class="flex flex-col gap-5">
      <Field id="defect-title" label={m.defect_title()} error={errors.title}>
        {#snippet children({ describedby, invalid })}
          <Input
            id="defect-title"
            class="h-10"
            required
            maxlength={200}
            autocomplete="off"
            placeholder={m.defect_title_placeholder()}
            aria-invalid={invalid || undefined}
            aria-describedby={describedby}
            bind:value={title}
          />
        {/snippet}
      </Field>
      <Field
        id="defect-description"
        label={m.defect_description()}
        optional
        error={errors.descriptionMd}
      >
        {#snippet children({ describedby, invalid })}
          <Textarea
            id="defect-description"
            rows={4}
            maxlength={50000}
            aria-invalid={invalid || undefined}
            aria-describedby={describedby}
            bind:value={description}
          />
        {/snippet}
      </Field>
      <div class="flex flex-col gap-2">
        <span class="text-sm leading-none font-medium"
          >{m.defect_severity()}</span
        >
        <Segmented
          options={severityOptions}
          bind:value={severity}
          label={m.defect_severity()}
        />
      </div>
    </Card.Content>
  </Card.Root>

  <Card.Root>
    <Card.Header>
      <Card.Title>{m.defect_form_place()}</Card.Title>
    </Card.Header>
    <Card.Content class="grid gap-5 sm:grid-cols-2">
      <Field id="defect-room" label={m.defect_room()} error={errors.roomId}>
        {#snippet children({ describedby, invalid })}
          <OptionSelect
            id="defect-room"
            bind:value={roomId}
            options={roomOptions}
            {invalid}
            {describedby}
          />
        {/snippet}
      </Field>
      <Field id="defect-asset" label={m.defect_asset()} error={errors.assetId}>
        {#snippet children({ describedby, invalid })}
          <OptionSelect
            id="defect-asset"
            bind:value={assetId}
            options={assetOptions}
            onchange={pickAsset}
            {invalid}
            {describedby}
          />
        {/snippet}
      </Field>
      <Field
        id="defect-location"
        label={m.defect_location_detail()}
        optional
        class="sm:col-span-2"
        error={errors.locationDetail}
      >
        {#snippet children({ describedby, invalid })}
          <Input
            id="defect-location"
            class="h-10"
            maxlength={500}
            autocomplete="off"
            placeholder={m.defect_location_detail_placeholder()}
            aria-invalid={invalid || undefined}
            aria-describedby={describedby}
            bind:value={locationDetail}
          />
        {/snippet}
      </Field>
    </Card.Content>
  </Card.Root>

  <Card.Root>
    <Card.Header>
      <Card.Title>{m.defect_form_handling()}</Card.Title>
    </Card.Header>
    <Card.Content class="flex flex-col gap-5">
      <div class="grid gap-5 sm:grid-cols-2">
        <Field
          id="defect-discovered"
          label={m.defect_discovered_on()}
          error={errors.discoveredOn}
        >
          {#snippet children({ describedby, invalid })}
            <Input
              id="defect-discovered"
              class="h-10"
              type="date"
              required
              max={today}
              aria-invalid={invalid || undefined}
              aria-describedby={describedby}
              bind:value={discoveredOn}
            />
          {/snippet}
        </Field>
        <Field
          id="defect-contact"
          label={m.defect_responsible()}
          optional
          hint={contacts.length === 0
            ? m.defect_responsible_empty()
            : undefined}
          error={errors.responsibleContactId}
        >
          {#snippet children({ describedby, invalid })}
            <OptionSelect
              id="defect-contact"
              bind:value={contactId}
              options={contactOptions}
              {invalid}
              {describedby}
            />
          {/snippet}
        </Field>
      </div>

      <div class="flex flex-col gap-2">
        <span class="text-sm leading-none font-medium"
          >{m.defect_deadline()}</span
        >
        <Segmented
          options={modeOptions}
          bind:value={mode}
          label={m.defect_deadline()}
        />
        {#if mode === "auto" && autoDate}
          <p
            class="text-muted-foreground text-xs text-pretty"
            aria-live="polite"
          >
            {m.defect_deadline_auto_hint({
              date: formatDay(autoDate),
              handover: formatDay(handoverDate ?? autoDate),
              months: deadlineMonths,
            })}
          </p>
        {:else if mode === "manual"}
          <Field
            id="defect-deadline"
            label={m.defect_deadline_date()}
            error={errors.deadlineDate}
            class="max-w-xs"
          >
            {#snippet children({ describedby, invalid })}
              <Input
                id="defect-deadline"
                class="h-10"
                type="date"
                required
                aria-invalid={invalid || undefined}
                aria-describedby={describedby}
                bind:value={deadlineDate}
              />
            {/snippet}
          </Field>
        {:else if mode === "none"}
          <p class="text-muted-foreground text-xs text-pretty">
            {m.defect_deadline_none_hint()}
          </p>
        {/if}
        {#if !handoverDate}
          <p class="text-muted-foreground text-xs text-pretty">
            {m.defect_deadline_no_handover()}
            <a
              href={resolve("/settings/household")}
              class="text-foreground underline underline-offset-2"
              >{m.defect_deadline_no_handover_link()}</a
            >
          </p>
        {:else if mode !== "none"}
          <p class="text-muted-foreground text-xs text-pretty">
            {m.defect_deadline_reminder_hint()}
          </p>
        {/if}
      </div>
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
      {:else if defect}
        {m.common_save()}
      {:else}
        {m.common_create()}
      {/if}
    </Button>
  </div>
</form>
