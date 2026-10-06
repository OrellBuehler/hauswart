<script lang="ts">
  import CircleAlertIcon from "@lucide/svelte/icons/circle-alert";
  import * as Alert from "$lib/components/ui/alert/index.js";

  let { message }: { message: string | undefined } = $props();

  let el = $state<HTMLElement | null>(null);

  $effect(() => {
    if (message && el) el.scrollIntoView({ block: "nearest" });
  });
</script>

{#if message}
  <Alert.Root bind:ref={el} variant="destructive" class="border-destructive/40">
    <CircleAlertIcon />
    <Alert.Description>{message}</Alert.Description>
  </Alert.Root>
{/if}
