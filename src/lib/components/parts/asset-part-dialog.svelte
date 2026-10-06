<script lang="ts">
  import LoaderCircleIcon from "@lucide/svelte/icons/loader-circle";
  import PlusIcon from "@lucide/svelte/icons/plus";
  import { toast } from "svelte-sonner";
  import { api } from "$lib/api/browser";
  import { fetchAll } from "$lib/api/fetch-all";
  import { endpoints } from "$lib/api/registry";
  import FormAlert from "$lib/components/app/form-alert.svelte";
  import FormDialog from "$lib/components/app/form-dialog.svelte";
  import PickerList from "$lib/components/app/picker-list.svelte";
  import { Button } from "$lib/components/ui/button/index.js";
  import { apiErrorMessage } from "$lib/error-message";
  import { m } from "$lib/paraglide/messages";

  type Option = { value: string; label: string; detail: string | null };

  let {
    open = $bindable(false),
    assetId,
    partId,
    excludeIds = [],
    oncreatenew,
    onlinked,
  }: {
    open?: boolean;
    /** Fixed asset: the dialog picks a part. */
    assetId?: string;
    /** Fixed part: the dialog picks an asset. */
    partId?: string;
    /** Ids already linked, left out of the list. */
    excludeIds?: string[];
    /** Offers "create a new part" when picking parts. */
    oncreatenew?: () => void;
    onlinked: () => void | Promise<void>;
  } = $props();

  let options = $state<Option[]>([]);
  let loading = $state(false);
  let loadError = $state<string | undefined>();
  let chosen = $state("");
  let chooseError = $state<string | undefined>();

  const pickingParts = $derived(assetId !== undefined);
  const items = $derived(options.filter((o) => !excludeIds.includes(o.value)));

  $effect(() => {
    if (!open) return;
    chosen = "";
    chooseError = undefined;
    void load();
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
              api.call(endpoints.assetsList, { query: { cursor, limit: 200 } }),
            )
          ).map((asset) => ({
            value: asset.id,
            label: asset.name,
            detail: asset.roomName,
          }));
    } catch (err) {
      loadError = apiErrorMessage(err);
    } finally {
      loading = false;
    }
  }

  async function submit(): Promise<string | void> {
    chooseError = undefined;
    if (!chosen) {
      chooseError = pickingParts
        ? m.part_link_choose()
        : m.part_link_choose_asset();
      return chooseError;
    }
    try {
      await api.call(endpoints.assetPartsLink, {
        params: { id: assetId ?? chosen },
        body: { partId: partId ?? chosen },
      });
    } catch (err) {
      return apiErrorMessage(err, { conflict: m.part_link_taken() });
    }
    toast.success(m.part_linked_toast());
    await onlinked();
  }

  function createNew() {
    open = false;
    oncreatenew?.();
  }
</script>

<FormDialog
  bind:open
  title={pickingParts ? m.part_link_title() : m.part_link_asset_title()}
  description={pickingParts
    ? m.part_link_description()
    : m.part_link_asset_description()}
  submitLabel={m.part_link_submit()}
  pendingLabel={m.common_saving()}
  onsubmit={submit}
>
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
      id="link-part-list"
      {items}
      bind:value={chosen}
      label={pickingParts ? m.part_link_list() : m.part_link_asset_list()}
      emptyText={pickingParts ? m.part_link_empty() : m.part_link_asset_empty()}
    />
    {#if chooseError}
      <p class="text-destructive -mt-3 text-xs">{chooseError}</p>
    {/if}
    {#if pickingParts && oncreatenew}
      <Button type="button" variant="ghost" class="w-fit" onclick={createNew}>
        <PlusIcon />{m.part_link_create_new()}
      </Button>
    {/if}
  {/if}
</FormDialog>
