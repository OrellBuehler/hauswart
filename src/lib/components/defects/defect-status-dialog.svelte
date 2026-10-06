<script lang="ts">
  import LoaderCircleIcon from "@lucide/svelte/icons/loader-circle";
  import { invalidateAll } from "$app/navigation";
  import { toast } from "svelte-sonner";
  import { api } from "$lib/api/browser";
  import type { DefectStatus } from "$lib/api/enums";
  import { endpoints } from "$lib/api/registry";
  import type { Defect } from "$lib/api/schemas/defects";
  import FormAlert from "$lib/components/app/form-alert.svelte";
  import { Button } from "$lib/components/ui/button/index.js";
  import * as Dialog from "$lib/components/ui/dialog/index.js";
  import { Input } from "$lib/components/ui/input/index.js";
  import { Label } from "$lib/components/ui/label/index.js";
  import { Textarea } from "$lib/components/ui/textarea/index.js";
  import { statusLabels } from "$lib/defects/labels";
  import { apiErrorMessage } from "$lib/error-message";
  import { m } from "$lib/paraglide/messages";

  let {
    open = $bindable(false),
    defect,
    target,
    today,
  }: {
    open?: boolean;
    defect: Defect;
    target: DefectStatus;
    today: string;
  } = $props();

  let date = $state("");
  let note = $state("");
  let resolution = $state("");
  let pending = $state(false);
  let error = $state<string | undefined>();

  const reopening = $derived(
    target === "open" &&
      (defect.status === "fixed" || defect.status === "rejected"),
  );

  $effect(() => {
    if (!open) return;
    date = target === "reported" ? (defect.reportedOn ?? today) : today;
    note = "";
    resolution = defect.resolutionMd;
    error = undefined;
  });

  const title = $derived(
    reopening
      ? m.defect_dialog_reopen_title()
      : {
          open: m.defect_dialog_back_title(),
          reported: m.defect_dialog_reported_title(),
          in_progress: m.defect_dialog_in_progress_title(),
          fixed: m.defect_dialog_fixed_title(),
          rejected: m.defect_dialog_rejected_title(),
        }[target],
  );
  const description = $derived(
    reopening
      ? m.defect_dialog_reopen_description()
      : {
          open: m.defect_dialog_back_description(),
          reported: m.defect_dialog_reported_description(),
          in_progress: m.defect_dialog_in_progress_description(),
          fixed: m.defect_dialog_fixed_description(),
          rejected: m.defect_dialog_rejected_description(),
        }[target],
  );
  const submitLabel = $derived(
    reopening
      ? m.defect_action_reopen()
      : {
          open: m.defect_action_back_to_open(),
          reported: m.defect_action_reported(),
          in_progress: m.defect_action_in_progress(),
          fixed: m.defect_action_fixed(),
          rejected: m.defect_action_rejected(),
        }[target],
  );

  async function submit(event: SubmitEvent) {
    event.preventDefault();
    if (pending) return;
    if ((target === "reported" || target === "fixed") && !date) {
      error = m.field_required();
      return;
    }
    if (date > today && (target === "reported" || target === "fixed")) {
      error = m.defect_dialog_future();
      return;
    }
    pending = true;
    error = undefined;
    try {
      const text = target === "fixed" ? resolution.trim() : note.trim();
      await api.call(endpoints.defectsStatus, {
        params: { id: defect.id },
        body: {
          status: target,
          ...(text ? { note: text } : {}),
          ...(target === "reported" ? { reportedOn: date } : {}),
          ...(target === "fixed" ? { fixedOn: date } : {}),
        },
      });
      if (target === "fixed" && text !== defect.resolutionMd.trim()) {
        try {
          await api.call(endpoints.defectsUpdate, {
            params: { id: defect.id },
            body: { resolutionMd: text },
          });
        } catch (err) {
          toast.error(
            m.defect_resolution_failed({ error: apiErrorMessage(err) }),
          );
        }
      }
      toast.success(m.defect_status_toast({ status: statusLabels[target]() }));
      open = false;
      await invalidateAll();
    } catch (err) {
      error = apiErrorMessage(err);
    } finally {
      pending = false;
    }
  }
</script>

<Dialog.Root bind:open={() => open, (value) => (open = pending ? true : value)}>
  <Dialog.Content class="max-h-[calc(100svh-2rem)] overflow-y-auto">
    <Dialog.Header>
      <Dialog.Title>{title}</Dialog.Title>
      <Dialog.Description>{description}</Dialog.Description>
    </Dialog.Header>
    <form class="flex flex-col gap-5" onsubmit={submit}>
      {#if target === "reported" || target === "fixed"}
        <div class="flex flex-col gap-2">
          <Label for="status-date">
            {target === "reported"
              ? m.defect_dialog_reported_on()
              : m.defect_dialog_fixed_on()}
          </Label>
          <Input
            id="status-date"
            type="date"
            required
            max={today}
            min={defect.discoveredOn}
            bind:value={date}
            class="h-10"
          />
        </div>
      {/if}
      {#if target === "fixed"}
        <div class="flex flex-col gap-2">
          <Label for="status-resolution">
            {m.defect_resolution()}
            <span class="text-muted-foreground font-normal"
              >({m.common_optional()})</span
            >
          </Label>
          <Textarea
            id="status-resolution"
            rows={4}
            maxlength={10000}
            placeholder={m.defect_resolution_placeholder()}
            bind:value={resolution}
          />
        </div>
      {:else}
        <div class="flex flex-col gap-2">
          <Label for="status-note">
            {m.defect_dialog_note()}
            <span class="text-muted-foreground font-normal"
              >({m.common_optional()})</span
            >
          </Label>
          <Textarea
            id="status-note"
            rows={3}
            maxlength={10000}
            bind:value={note}
          />
        </div>
      {/if}
      <FormAlert message={error} />
      <Dialog.Footer class="gap-2">
        <Button
          type="button"
          variant="outline"
          size="lg"
          disabled={pending}
          onclick={() => (open = false)}
        >
          {m.common_cancel()}
        </Button>
        <Button
          type="submit"
          size="lg"
          variant={target === "rejected" ? "destructive" : "default"}
          disabled={pending}
        >
          {#if pending}
            <LoaderCircleIcon class="animate-spin" />
          {/if}
          {submitLabel}
        </Button>
      </Dialog.Footer>
    </form>
  </Dialog.Content>
</Dialog.Root>
