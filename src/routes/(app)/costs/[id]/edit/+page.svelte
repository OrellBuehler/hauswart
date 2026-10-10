<script lang="ts">
  import ArrowLeftIcon from "@lucide/svelte/icons/arrow-left";
  import { resolve } from "$app/paths";
  import PageHeader from "$lib/components/app/page-header.svelte";
  import CostForm from "$lib/components/costs/cost-form.svelte";
  import { Button } from "$lib/components/ui/button/index.js";
  import { m } from "$lib/paraglide/messages";
  import type { PageProps } from "./$types";

  let { data }: PageProps = $props();
</script>

<svelte:head>
  <title>{m.cost_edit_title()} · {m.app_name()}</title>
</svelte:head>

<div class="flex flex-col gap-6">
  <div class="flex flex-col gap-4">
    <Button
      href={resolve(`/costs/${data.cost.id}` as "/")}
      variant="ghost"
      size="sm"
      class="text-muted-foreground -ms-2 w-fit max-w-full min-w-0"
    >
      <ArrowLeftIcon />
      <span class="truncate">{data.cost.title}</span>
    </Button>
    <PageHeader title={m.cost_edit_title()} />
  </div>
  {#key data.cost.id}
    <CostForm
      entry={data.cost}
      rooms={data.rooms}
      assets={data.assets}
      defects={data.defects}
      people={data.people}
      currency={data.currency}
      today={data.today}
      currentUserId={data.user.id}
    />
  {/key}
</div>
