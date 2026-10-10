<script lang="ts">
  import ArrowLeftIcon from "@lucide/svelte/icons/arrow-left";
  import { resolve } from "$app/paths";
  import PageHeader from "$lib/components/app/page-header.svelte";
  import PolicyForm from "$lib/components/insurance/policy-form.svelte";
  import { Button } from "$lib/components/ui/button/index.js";
  import { m } from "$lib/paraglide/messages";
  import type { PageProps } from "./$types";

  let { data }: PageProps = $props();
</script>

<svelte:head>
  <title>{m.insurance_new()} · {m.app_name()}</title>
</svelte:head>

<div class="flex flex-col gap-6">
  <div class="flex flex-col gap-4">
    <Button
      href={resolve("/insurance")}
      variant="ghost"
      size="sm"
      class="text-muted-foreground -ms-2 w-fit max-md:hidden"
    >
      <ArrowLeftIcon />{m.nav_insurance()}
    </Button>
    <PageHeader
      title={m.insurance_new()}
      description={m.insurance_new_description()}
    />
  </div>
  <PolicyForm
    assets={data.assets}
    currency={data.currency}
    today={data.today}
    defaults={data.defaults}
  />
</div>
