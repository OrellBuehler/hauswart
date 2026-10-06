<script lang="ts">
  import CompassIcon from "@lucide/svelte/icons/compass";
  import LockKeyholeIcon from "@lucide/svelte/icons/lock-keyhole";
  import TriangleAlertIcon from "@lucide/svelte/icons/triangle-alert";
  import { resolve } from "$app/paths";
  import { Button } from "$lib/components/ui/button/index.js";
  import { m } from "$lib/paraglide/messages";
  import EmptyState from "./empty-state.svelte";

  let { status, message }: { status: number; message: string } = $props();

  const title = $derived(
    status === 404
      ? m.error_page_not_found_title()
      : status === 403
        ? m.error_page_forbidden_title()
        : m.error_page_generic_title(),
  );
  const description = $derived(
    status === 404
      ? m.error_page_not_found_body()
      : status === 403
        ? m.error_page_forbidden_body()
        : message,
  );
  const icon = $derived(
    status === 404
      ? CompassIcon
      : status === 403
        ? LockKeyholeIcon
        : TriangleAlertIcon,
  );
</script>

<svelte:head>
  <title>{title} · {m.app_name()}</title>
</svelte:head>

<div class="mx-auto flex min-h-[60svh] max-w-lg flex-col justify-center">
  <p class="text-muted-foreground mb-3 text-center text-xs tabular-nums">
    {m.error_page_status({ status })}
  </p>
  <EmptyState {icon} {title} {description}>
    {#snippet actions()}
      <Button href={resolve("/")}>{m.common_back_home()}</Button>
    {/snippet}
  </EmptyState>
</div>
