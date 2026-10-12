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
  <title>{m.recurrence_edit_title()} · {m.app_name()}</title>
</svelte:head>

<div class="flex flex-col gap-6">
  <div class="flex flex-col gap-4">
    <Button
      href={resolve(`/costs/recurring/${data.recurrence.id}` as "/")}
      variant="ghost"
      size="sm"
      class="text-muted-foreground -ms-2 w-fit max-w-full min-w-0 max-md:hidden"
    >
      <ArrowLeftIcon />
      <span class="truncate">{data.recurrence.title}</span>
    </Button>
    <PageHeader title={m.recurrence_edit_title()} />
  </div>
  {#key data.recurrence.id}
    <RecurrenceForm
      recurrence={data.recurrence}
      rooms={data.rooms}
      assets={data.assets}
      people={data.people}
      books={data.books}
      tags={data.tags}
      currency={data.currency}
      today={data.today}
      currentUserId={data.user.id}
    />
  {/key}
</div>
