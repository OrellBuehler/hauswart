<script lang="ts">
  import PageHeader from "$lib/components/app/page-header.svelte";
  import TaskForm from "$lib/components/tasks/task-form.svelte";
  import { m } from "$lib/paraglide/messages";
  import type { PageProps } from "./$types";

  let { data }: PageProps = $props();
</script>

<svelte:head>
  <title>{m.task_edit_title({ title: data.task.title })} · {m.app_name()}</title
  >
</svelte:head>

<div class="flex flex-col gap-6">
  <PageHeader
    class="wrap-anywhere"
    title={m.task_edit_title({ title: data.task.title })}
    description={m.task_edit_description()}
  />
  {#key data.task.id}
    <TaskForm
      task={data.task}
      people={data.people}
      rooms={data.rooms}
      assets={data.assets}
      today={data.today}
      dueSoonDefault={data.dueSoonDays}
    />
  {/key}
</div>
