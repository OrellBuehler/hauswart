<script lang="ts">
  import { Dialog as DialogPrimitive } from "bits-ui";
  import { useOverlayHistory } from "$lib/overlays/use-overlay-history.svelte";

  let {
    open = $bindable(false),
    closeOnBack = true,
    ...restProps
  }: DialogPrimitive.RootProps & {
    /** The back gesture closes the dialog instead of leaving the page. */
    closeOnBack?: boolean;
  } = $props();

  useOverlayHistory({
    open: () => open,
    close: () => (open = false),
    enabled: () => closeOnBack,
  });
</script>

<DialogPrimitive.Root bind:open {...restProps} />
