<script lang="ts">
  import ArrowLeftIcon from "@lucide/svelte/icons/arrow-left";
  import PageHeader from "$lib/components/app/page-header.svelte";
  import PolicyForm from "$lib/components/insurance/policy-form.svelte";
  import { Button } from "$lib/components/ui/button/index.js";
  import { insuranceHref } from "$lib/links";
  import { m } from "$lib/paraglide/messages";
  import type { PageProps } from "./$types";

  let { data }: PageProps = $props();
</script>

<svelte:head>
  <title>{m.insurance_edit_title()} · {m.app_name()}</title>
</svelte:head>

<div class="flex flex-col gap-6">
  <div class="flex flex-col gap-4">
    <Button
      href={insuranceHref(data.policy.id)}
      variant="ghost"
      size="sm"
      class="text-muted-foreground -ms-2 w-fit max-w-full min-w-0 max-md:hidden"
    >
      <ArrowLeftIcon /><span class="truncate">{data.policy.title}</span>
    </Button>
    <PageHeader class="wrap-anywhere" title={m.insurance_edit_title()} />
  </div>
  {#key data.policy.id}
    <PolicyForm
      policy={data.policy}
      assets={data.assets}
      currency={data.currency}
      today={data.today}
    />
  {/key}
</div>
