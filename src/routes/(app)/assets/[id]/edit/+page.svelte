<script lang="ts">
  import { resolve } from "$app/paths";
  import ArrowLeftIcon from "@lucide/svelte/icons/arrow-left";
  import AssetForm from "$lib/components/assets/asset-form.svelte";
  import PageHeader from "$lib/components/app/page-header.svelte";
  import { Button } from "$lib/components/ui/button/index.js";
  import { m } from "$lib/paraglide/messages";
  import type { PageProps } from "./$types";

  let { data }: PageProps = $props();
</script>

<svelte:head>
  <title>{m.asset_edit_title({ name: data.asset.name })} · {m.app_name()}</title
  >
</svelte:head>

<div class="mx-auto flex max-w-2xl flex-col gap-6">
  <div class="flex flex-col gap-4">
    <Button
      href={resolve(`/assets/${data.asset.id}`)}
      variant="ghost"
      size="sm"
      class="text-muted-foreground -ms-2 w-fit"
    >
      <ArrowLeftIcon />{data.asset.name}
    </Button>
    <PageHeader title={m.asset_edit_title({ name: data.asset.name })} />
  </div>
  {#key data.asset.id}
    <AssetForm rooms={data.rooms} asset={data.asset} today={data.today} />
  {/key}
</div>
