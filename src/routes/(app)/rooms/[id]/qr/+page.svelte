<script lang="ts">
  import { page } from "$app/state";
  import { resolve } from "$app/paths";
  import QrSheet from "$lib/components/assets/qr-sheet.svelte";
  import { m } from "$lib/paraglide/messages";
  import type { PageProps } from "./$types";

  let { data }: PageProps = $props();
</script>

<svelte:head>
  <title>{m.qr_sheet_title({ name: data.room.name })} · {m.app_name()}</title>
</svelte:head>

<QrSheet
  title={m.qr_sheet_title({ name: data.room.name })}
  assets={data.assets}
  origin={page.url.origin}
  backHref={resolve(`/rooms/${data.room.id}`)}
  backLabel={data.room.name}
/>
