<script lang="ts">
  import LoaderCircleIcon from "@lucide/svelte/icons/loader-circle";
  import { toast } from "svelte-sonner";
  import { api } from "$lib/api/browser";
  import { fetchAll } from "$lib/api/fetch-all";
  import { endpoints } from "$lib/api/registry";
  import FormAlert from "$lib/components/app/form-alert.svelte";
  import FormDialog from "$lib/components/app/form-dialog.svelte";
  import PickerList from "$lib/components/app/picker-list.svelte";
  import Field from "$lib/components/tasks/field.svelte";
  import NumberField from "$lib/components/tasks/number-field.svelte";
  import { Button } from "$lib/components/ui/button/index.js";
  import { apiErrorMessage } from "$lib/error-message";
  import { m } from "$lib/paraglide/messages";

  type Option = { value: string; label: string; detail: string | null };

  let {
    open = $bindable(false),
    taskId,
    partId,
    existing,
    excludeIds = [],
    onsaved,
  }: {
    open?: boolean;
    /** Fixed task: the dialog picks a part. */
    taskId?: string;
    /** Fixed part: the dialog picks a task. */
    partId?: string;
    /** Changes the quantity of an existing link instead of adding one. */
    existing?: { taskId: string; partId: string; label: string; qty: number };
    /** Ids already linked, left out of the list. */
    excludeIds?: string[];
    onsaved: () => void | Promise<void>;
  } = $props();

  let options = $state<Option[]>([]);
  let loading = $state(false);
  let loadError = $state<string | undefined>();
  let chosen = $state("");
  let qty = $state<number | undefined>(1);
  let chooseError = $state<string | undefined>();
  let qtyError = $state<string | undefined>();

  const editing = $derived(existing !== undefined);
  const pickingParts = $derived(taskId !== undefined);
  const items = $derived(options.filter((o) => !excludeIds.includes(o.value)));

  $effect(() => {
    if (!open) return;
    chosen = "";
    qty = existing?.qty ?? 1;
    chooseError = undefined;
    qtyError = undefined;
    if (!editing) void load();
  });

  async function load() {
    loading = true;
    loadError = undefined;
    try {
      options = pickingParts
        ? (
            await fetchAll((cursor) =>
              api.call(endpoints.partsList, { query: { cursor, limit: 200 } }),
            )
          ).map((part) => ({
            value: part.id,
            label: part.name,
            detail: [part.partNumber, part.supplier]
              .filter(Boolean)
              .join(" · "),
          }))
        : (
            await fetchAll((cursor) =>
              api.call(endpoints.tasksList, { query: { cursor, limit: 200 } }),
            )
          ).map((task) => ({
            value: task.id,
            label: task.title,
            detail: task.assetName ?? task.roomName,
          }));
    } catch (err) {
      loadError = apiErrorMessage(err);
    } finally {
      loading = false;
    }
  }

  async function submit(): Promise<string | void> {
    chooseError = undefined;
    qtyError = undefined;
    if (!editing && !chosen) {
      chooseError = pickingParts
        ? m.part_link_choose()
        : m.part_link_choose_task();
      return chooseError;
    }
    if (qty === undefined || !Number.isInteger(qty) || qty < 1 || qty > 999) {
      qtyError = m.field_min({ min: 1 });
      return m.form_check_fields();
    }
    try {
      if (existing) {
        await api.call(endpoints.taskPartsUpdate, {
          params: { id: existing.taskId, partId: existing.partId },
          body: { qty },
        });
      } else {
        await api.call(endpoints.taskPartsLink, {
          params: { id: taskId ?? chosen },
          body: { partId: partId ?? chosen, qty },
        });
      }
    } catch (err) {
      return apiErrorMessage(err, { conflict: m.part_link_taken() });
    }
    toast.success(editing ? m.part_qty_saved_toast() : m.part_linked_toast());
    await onsaved();
  }
</script>

<FormDialog
  bind:open
  title={editing
    ? m.task_part_edit_title()
    : pickingParts
      ? m.task_part_link_title()
      : m.part_link_task_title()}
  description={editing
    ? m.task_part_edit_description({ name: existing?.label ?? "" })
    : m.task_part_link_description()}
  submitLabel={editing ? m.common_save() : m.part_link_submit()}
  pendingLabel={m.common_saving()}
  onsubmit={submit}
>
  {#if !editing}
    {#if loading}
      <p class="text-muted-foreground flex items-center gap-2 text-sm">
        <LoaderCircleIcon class="size-4 animate-spin" aria-hidden="true" />
        {m.common_loading()}
      </p>
    {:else if loadError}
      <FormAlert message={loadError} />
      <Button type="button" variant="outline" onclick={load}>
        {m.common_retry()}
      </Button>
    {:else}
      <PickerList
        id="task-part-list"
        {items}
        bind:value={chosen}
        label={pickingParts ? m.part_link_list() : m.part_link_task_list()}
        emptyText={pickingParts
          ? m.part_link_empty()
          : m.part_link_task_empty()}
      />
      {#if chooseError}
        <p class="text-destructive -mt-3 text-xs">{chooseError}</p>
      {/if}
    {/if}
  {/if}
  <Field
    id="task-part-qty"
    label={m.task_part_qty()}
    hint={m.task_part_qty_hint()}
    error={qtyError}
  >
    {#snippet children({ describedby, invalid })}
      <NumberField
        id="task-part-qty"
        bind:value={qty}
        {invalid}
        {describedby}
        class="max-w-32"
      />
    {/snippet}
  </Field>
</FormDialog>
