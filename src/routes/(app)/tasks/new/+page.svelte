<script lang="ts">
  import PageHeader from "$lib/components/app/page-header.svelte";
  import TaskForm from "$lib/components/tasks/task-form.svelte";
  import { m } from "$lib/paraglide/messages";
  import type { PageProps } from "./$types";

  let { data }: PageProps = $props();
</script>

<svelte:head>
  <title>{m.task_new()} · {m.app_name()}</title>
</svelte:head>

<div class="flex flex-col gap-6">
  <PageHeader title={m.task_new()} description={m.task_new_description()} />
  <TaskForm
    people={data.people}
    rooms={data.rooms}
    assets={data.assets}
    today={data.today}
    dueSoonDefault={data.dueSoonDays}
    defaults={data.defaults}
  />
</div>
