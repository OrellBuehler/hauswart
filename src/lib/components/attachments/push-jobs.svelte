<script lang="ts">
  import FileCheckIcon from "@lucide/svelte/icons/file-check";
  import FileClockIcon from "@lucide/svelte/icons/file-clock";
  import FileUpIcon from "@lucide/svelte/icons/file-up";
  import FileXIcon from "@lucide/svelte/icons/file-x";
  import LoaderCircleIcon from "@lucide/svelte/icons/loader-circle";
  import XIcon from "@lucide/svelte/icons/x";
  import type { AttachmentOwnerType } from "$lib/api/enums";
  import { Button } from "$lib/components/ui/button/index.js";
  import {
    dismissPush,
    isActive,
    pushErrorMessage,
    pushes,
    type PushJob,
  } from "$lib/documents/pushes.svelte";
  import { m } from "$lib/paraglide/messages";
  import { cn } from "$lib/utils";

  let {
    ownerType,
    ownerId,
  }: {
    ownerType: AttachmentOwnerType;
    ownerId: string;
  } = $props();

  const jobs = $derived(
    pushes.jobs.filter(
      (job) => job.ownerType === ownerType && job.ownerId === ownerId,
    ),
  );

  function statusText(job: PushJob): string {
    switch (job.status) {
      case "queued":
      case "uploading":
        return m.document_push_status_uploading();
      case "processing":
        return m.document_push_status_processing();
      case "done":
        return job.duplicate
          ? m.document_push_status_duplicate()
          : m.document_push_status_done();
      case "failed":
        return pushErrorMessage(job.errorCode, job.provider);
      case "unknown":
        return m.document_push_status_unknown();
    }
  }
</script>

{#if jobs.length > 0}
  <ul class="flex flex-col gap-2" aria-label={m.document_push_jobs()}>
    {#each jobs as job (job.id)}
      <li
        class={cn(
          "flex items-center gap-3 rounded-lg border p-2.5",
          job.status === "failed" && "border-destructive/40 bg-destructive/5",
        )}
        role={job.status === "failed" ? "alert" : "status"}
      >
        <span
          class={cn(
            "bg-muted text-muted-foreground flex size-10 shrink-0 items-center justify-center rounded-md",
            job.status === "done" && "bg-success/12 text-success",
            job.status === "failed" && "bg-destructive/10 text-destructive",
          )}
          aria-hidden="true"
        >
          {#if job.status === "done"}
            <FileCheckIcon class="size-5" />
          {:else if job.status === "failed"}
            <FileXIcon class="size-5" />
          {:else if job.status === "unknown"}
            <FileClockIcon class="size-5" />
          {:else}
            <FileUpIcon class="size-5" />
          {/if}
        </span>
        <div class="min-w-0 flex-1">
          <p class="truncate text-sm font-medium">{job.name}</p>
          <p
            class={cn(
              "text-xs text-pretty",
              job.status === "failed"
                ? "text-destructive"
                : "text-muted-foreground",
            )}
          >
            {statusText(job)}
          </p>
          {#if job.status === "done" && job.warning === "permissions_failed"}
            <p class="text-warning text-xs text-pretty">
              {m.document_push_permissions_failed()}
            </p>
          {/if}
        </div>
        {#if isActive(job)}
          <LoaderCircleIcon
            class="text-muted-foreground size-4 shrink-0 animate-spin"
            aria-hidden="true"
          />
        {:else}
          <Button
            variant="ghost"
            size="icon-sm"
            class="shrink-0"
            aria-label={m.document_push_dismiss_aria({ name: job.name })}
            onclick={() => dismissPush(job.id)}
          >
            <XIcon />
          </Button>
        {/if}
      </li>
    {/each}
  </ul>
{/if}
