<script lang="ts">
  import { resolve } from "$app/paths";
  import ArrowLeftIcon from "@lucide/svelte/icons/arrow-left";
  import AssetForm from "$lib/components/assets/asset-form.svelte";
  import PageHeader from "$lib/components/app/page-header.svelte";
  import { Button } from "$lib/components/ui/button/index.js";
  import { m } from "$lib/paraglide/messages";
  import type { PageProps } from "./$types";

  let { data }: PageProps = $props();

  const isPlant = $derived(data.kind === "plant");
  const heading = $derived(
    isPlant
      ? m.plants_create()
      : data.kind === "vehicle"
        ? m.vehicle_create()
        : m.inventory_create(),
  );
</script>

<svelte:head>
  <title>
    {heading} · {m.app_name()}
  </title>
</svelte:head>

<div class="flex flex-col gap-6">
  <div class="flex flex-col gap-4">
    <Button
      href={isPlant ? resolve("/plants") : resolve("/inventory")}
      variant="ghost"
      size="sm"
      class="text-muted-foreground -ms-2 w-fit max-md:hidden"
    >
      <ArrowLeftIcon />{isPlant ? m.nav_plants() : m.nav_inventory()}
    </Button>
    <PageHeader title={heading} description={m.asset_create_description()} />
  </div>
  {#key data.kind}
    <AssetForm
      rooms={data.rooms}
      today={data.today}
      initialKind={data.kind}
      initialRoomId={data.roomId}
    />
  {/key}
</div>
