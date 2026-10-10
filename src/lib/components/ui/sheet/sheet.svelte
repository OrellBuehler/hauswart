<script lang="ts">
  import { Dialog as SheetPrimitive } from "bits-ui";
  import { useOverlayHistory } from "$lib/overlays/use-overlay-history.svelte";

  let {
    open = $bindable(false),
    closeOnBack = true,
    ...restProps
  }: SheetPrimitive.RootProps & {
    /** The back gesture closes the sheet instead of leaving the page. */
    closeOnBack?: boolean;
  } = $props();

  useOverlayHistory({
    open: () => open,
    close: () => (open = false),
    enabled: () => closeOnBack,
  });
</script>

<SheetPrimitive.Root bind:open {...restProps} />
