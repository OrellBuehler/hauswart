<script lang="ts">
  import CheckIcon from "@lucide/svelte/icons/check";
  import LoaderCircleIcon from "@lucide/svelte/icons/loader-circle";
  import { invalidateAll } from "$app/navigation";
  import { toast } from "svelte-sonner";
  import { api } from "$lib/api/browser";
  import { endpoints } from "$lib/api/registry";
  import { Button } from "$lib/components/ui/button/index.js";
  import { apiErrorMessage } from "$lib/error-message";
  import { taskHref } from "$lib/links";
  import { m } from "$lib/paraglide/messages";
  import { dueWording } from "$lib/tasks/row";
  import { cn } from "$lib/utils";

  let {
    taskId,
    taskTitle,
    prepId,
    title,
    date,
    today,
    onstart,
    onfail,
    onsettled,
    class: className,
  }: {
    taskId: string;
    taskTitle: string;
    prepId: string;
    title: string;
    date: string | null;
    today: string;
    onstart?: () => void;
    onfail?: () => void;
    onsettled?: () => void;
    class?: string;
  } = $props();

  let pending = $state(false);
  const wording = $derived(date ? dueWording(date, today) : null);

  async function complete() {
    if (pending) return;
    pending = true;
    onstart?.();
    try {
      await api.call(endpoints.preparationsComplete, {
        params: { id: taskId, prepId },
        body: {},
      });
      toast.success(m.toast_prep_done({ title }));
      await invalidateAll();
    } catch (err) {
      onfail?.();
      toast.error(apiErrorMessage(err));
    } finally {
      pending = false;
      onsettled?.();
    }
  }
</script>

<div
  class={cn(
    "flex flex-col gap-3 py-3.5 sm:flex-row sm:items-center sm:gap-4",
    className,
  )}
>
  <div class="min-w-0 flex-1">
    <p class="font-medium text-pretty break-words">{title}</p>
    <p class="text-muted-foreground mt-0.5 text-xs text-pretty">
      {m.dashboard_prep_for()}
      <a
        href={taskHref(taskId)}
        class="focus-visible:ring-ring/50 rounded outline-none hover:underline focus-visible:ring-[3px]"
        >{taskTitle}</a
      >
      {#if wording}
        <span class="mx-1" aria-hidden="true">·</span>{m.dashboard_prep_due({
          when: wording.relative,
        })}
      {/if}
    </p>
  </div>
  <Button
    variant="outline"
    size="lg"
    class="sm:shrink-0"
    disabled={pending}
    aria-label={m.dashboard_prep_done_aria({ title })}
    onclick={complete}
  >
    {#if pending}
      <LoaderCircleIcon class="animate-spin" />
    {:else}
      <CheckIcon />
    {/if}
    {m.task_complete()}
  </Button>
</div>
