<script lang="ts">
  import { toast } from "svelte-sonner";
  import { api } from "$lib/api/browser";
  import { endpoints } from "$lib/api/registry";
  import type { CalendarTarget } from "$lib/api/schemas/calendar-sync";
  import ConfirmDialog from "$lib/components/app/confirm-dialog.svelte";
  import { Checkbox } from "$lib/components/ui/checkbox/index.js";
  import { deleteFailure } from "$lib/calendar-sync/errors";
  import { providerName } from "$lib/calendar-sync/providers";
  import { m } from "$lib/paraglide/messages";

  let {
    open = $bindable(false),
    target,
    onremoved,
  }: {
    open?: boolean;
    target: CalendarTarget | undefined;
    onremoved: () => void | Promise<void>;
  } = $props();

  let removeRemote = $state(false);

  /** Only a calendar that says it can delete lets hauswart take its own entries out. */
  const canRemoveRemote = $derived(target?.capabilities?.delete === true);

  $effect(() => {
    if (open) removeRemote = false;
  });

  async function remove() {
    if (!target) return;
    const { id, name } = target;
    const withRemote = canRemoveRemote && removeRemote;
    await api.call(endpoints.calendarTargetsDelete, {
      params: { id },
      ...(withRemote ? { query: { removeRemote: "true" as const } } : {}),
    });
    toast.success(
      withRemote
        ? m.caltargets_deleted_remote_toast({ name })
        : m.caltargets_deleted_toast({ name }),
    );
    await onremoved();
  }
</script>

<ConfirmDialog
  bind:open
  title={m.caltargets_delete_title()}
  description={m.caltargets_delete_description({
    name: target?.name ?? "",
    provider: target ? providerName(target.provider) : "",
  })}
  confirmLabel={m.caltargets_delete_confirm()}
  pendingLabel={m.caltargets_delete_pending()}
  destructive
  onconfirm={remove}
  errorMessage={(err) =>
    deleteFailure(err, target?.provider ?? "homeassistant")}
>
  {#if canRemoveRemote}
    <label class="flex min-h-11 cursor-pointer items-start gap-3 py-1">
      <Checkbox
        id="caltarget-remove-remote"
        class="mt-0.5"
        bind:checked={removeRemote}
      />
      <span
        class="flex min-w-0 flex-col items-start gap-0.5 text-sm leading-snug font-medium"
      >
        <span>{m.caltargets_delete_remove_remote()}</span>
        <span class="text-muted-foreground text-xs font-normal text-pretty">
          {m.caltargets_delete_remove_remote_hint()}
        </span>
      </span>
    </label>
  {/if}
  {#if !canRemoveRemote}
    <p class="text-muted-foreground text-xs text-pretty">
      {m.caltargets_delete_no_delete()}
    </p>
  {:else if !removeRemote}
    <p class="text-muted-foreground -mt-1 text-xs text-pretty">
      {m.caltargets_delete_keep_hint()}
    </p>
  {/if}
</ConfirmDialog>
