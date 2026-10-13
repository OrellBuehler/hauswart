<script lang="ts">
  import ArrowLeftIcon from "@lucide/svelte/icons/arrow-left";
  import { resolve } from "$app/paths";
  import PageHeader from "$lib/components/app/page-header.svelte";
  import RecurrenceForm from "$lib/components/costs/recurrence-form.svelte";
  import { Button } from "$lib/components/ui/button/index.js";
  import { m } from "$lib/paraglide/messages";
  import type { PageProps } from "./$types";

  let { data }: PageProps = $props();
</script>

<svelte:head>
  <title>{m.recurrence_new_title()} · {m.app_name()}</title>
</svelte:head>

<div class="flex flex-col gap-6">
  <div class="flex flex-col gap-4">
    <Button
      href={resolve("/costs/recurring")}
      variant="ghost"
      size="sm"
      class="text-muted-foreground -ms-2 w-fit max-md:hidden"
    >
      <ArrowLeftIcon />{m.recurrence_back()}
    </Button>
    <PageHeader
      title={m.recurrence_new_title()}
      description={m.recurrence_new_description()}
    />
  </div>
  <RecurrenceForm
    rooms={data.rooms}
    assets={data.assets}
    people={data.people}
    books={data.books}
    tags={data.tags}
    currency={data.currency}
    today={data.today}
    currentUserId={data.user.id}
    defaults={data.defaults}
  />
</div>
