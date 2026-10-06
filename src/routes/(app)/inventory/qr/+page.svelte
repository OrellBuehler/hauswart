<script lang="ts">
  import { page } from "$app/state";
  import { resolve } from "$app/paths";
  import QrSheet from "$lib/components/assets/qr-sheet.svelte";
  import { m } from "$lib/paraglide/messages";
  import type { PageProps } from "./$types";

  let { data }: PageProps = $props();
</script>

<svelte:head>
  <title>{m.qr_sheet_all_title()} · {m.app_name()}</title>
</svelte:head>

<QrSheet
  title={m.qr_sheet_all_title()}
  assets={data.assets}
  origin={page.url.origin}
  backHref={resolve("/inventory")}
  backLabel={m.nav_inventory()}
  showRoom
/>
