<script lang="ts">
  import ArrowLeftIcon from "@lucide/svelte/icons/arrow-left";
  import { resolve } from "$app/paths";
  import PageHeader from "$lib/components/app/page-header.svelte";
  import DefectForm from "$lib/components/defects/defect-form.svelte";
  import { Button } from "$lib/components/ui/button/index.js";
  import { m } from "$lib/paraglide/messages";
  import type { PageProps } from "./$types";

  let { data }: PageProps = $props();
</script>

<svelte:head>
  <title>{m.defect_new()} · {m.app_name()}</title>
</svelte:head>

<div class="mx-auto flex max-w-2xl flex-col gap-6">
  <div class="flex flex-col gap-4">
    <Button
      href={resolve("/defects")}
      variant="ghost"
      size="sm"
      class="text-muted-foreground -ms-2 w-fit"
    >
      <ArrowLeftIcon />{m.nav_defects()}
    </Button>
    <PageHeader
      title={m.defect_new()}
      description={m.defect_new_description()}
    />
  </div>
  <DefectForm
    rooms={data.rooms}
    assets={data.assets}
    contacts={data.contacts}
    today={data.today}
    handoverDate={data.handoverDate}
    deadlineMonths={data.deadlineMonths}
    defaults={data.defaults}
  />
</div>
