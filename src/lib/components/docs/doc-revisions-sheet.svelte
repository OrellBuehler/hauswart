<script lang="ts">
  import ArrowLeftIcon from "@lucide/svelte/icons/arrow-left";
  import HistoryIcon from "@lucide/svelte/icons/history";
  import RotateCcwIcon from "@lucide/svelte/icons/rotate-ccw";
  import { toast } from "svelte-sonner";
  import { api } from "$lib/api/browser";
  import { endpoints } from "$lib/api/registry";
  import type { DocPage } from "$lib/api/schemas/docs";
  import ConfirmDialog from "$lib/components/app/confirm-dialog.svelte";
  import FormAlert from "$lib/components/app/form-alert.svelte";
  import { Badge } from "$lib/components/ui/badge/index.js";
  import { Button } from "$lib/components/ui/button/index.js";
  import * as Sheet from "$lib/components/ui/sheet/index.js";
  import { Skeleton } from "$lib/components/ui/skeleton/index.js";
  import { pageErrorMessage } from "$lib/docs/errors";
  import { formatDateTime } from "$lib/format";
  import { formatBytes } from "$lib/attachments/files";
  import { m } from "$lib/paraglide/messages";
  import { cn } from "$lib/utils";
  import type { z } from "zod";
  import type {
    listRevisionsResponseSchema,
    pageRevisionSchema,
  } from "$lib/api/schemas/docs";

  type Revisions = z.output<typeof listRevisionsResponseSchema>["items"];
  type Revision = z.output<typeof pageRevisionSchema>;

  let {
    open = $bindable(false),
    slug,
    currentRev,
    canWrite,
    timeZone,
    onrestored,
  }: {
    open?: boolean;
    slug: string;
    currentRev: number;
    canWrite: boolean;
    timeZone?: string | undefined;
    /** Called with the page after an old revision was made current. */
    onrestored: (page: DocPage) => void | Promise<void>;
  } = $props();

  let items = $state.raw<Revisions>([]);
  let phase = $state<"idle" | "loading" | "ready" | "error">("idle");
  let loadError = $state<string | undefined>();
  let viewing = $state.raw<Revision | null>(null);
  let viewPhase = $state<"idle" | "loading" | "error">("idle");
  let viewError = $state<string | undefined>();
  let restoreOpen = $state(false);
  let generation = 0;

  async function load() {
    const current = ++generation;
    phase = "loading";
    loadError = undefined;
    try {
      const result = await api.call(endpoints.pageRevisionsList, {
        params: { slug },
      });
      if (current !== generation) return;
      items = result.items;
      phase = "ready";
    } catch (err) {
      if (current !== generation) return;
      loadError = pageErrorMessage(err);
      phase = "error";
    }
  }

  $effect(() => {
    if (open) {
      void load();
    } else {
      generation += 1;
      viewing = null;
      viewPhase = "idle";
      phase = "idle";
    }
  });

  async function view(rev: number) {
    viewPhase = "loading";
    viewError = undefined;
    try {
      viewing = await api.call(endpoints.pageRevisionsGet, {
        params: { slug, rev },
      });
      viewPhase = "idle";
    } catch (err) {
      viewError = pageErrorMessage(err);
      viewPhase = "error";
    }
  }

  async function restore() {
    if (!viewing) return;
    const page = await api.call(endpoints.pageRevisionsRestore, {
      params: { slug, rev: viewing.rev },
    });
    toast.success(m.docs_restored_toast({ rev: viewing.rev }));
    open = false;
    await onrestored(page);
  }
</script>

<Sheet.Root bind:open>
  <Sheet.Content side="right" class="w-full gap-0 sm:max-w-lg">
    <Sheet.Header class="border-b">
      <Sheet.Title class="flex items-center gap-2">
        <HistoryIcon class="size-4" aria-hidden="true" />
        {m.docs_history_title()}
      </Sheet.Title>
      <Sheet.Description>{m.docs_history_description()}</Sheet.Description>
    </Sheet.Header>

    <div class="min-h-0 flex-1 overflow-y-auto p-4">
      {#if viewing || viewPhase !== "idle"}
        <div class="flex flex-col gap-4">
          <Button
            variant="ghost"
            size="sm"
            class="text-muted-foreground -ms-2 w-fit"
            onclick={() => {
              viewing = null;
              viewPhase = "idle";
            }}
          >
            <ArrowLeftIcon />{m.docs_history_back()}
          </Button>
          {#if viewPhase === "loading"}
            <div
              class="flex flex-col gap-2"
              role="status"
              aria-label={m.common_loading()}
            >
              <Skeleton class="h-5 w-2/3" />
              <Skeleton class="h-40 w-full" />
            </div>
          {:else if viewPhase === "error"}
            <FormAlert message={viewError} />
          {:else if viewing}
            <div class="flex flex-col gap-1">
              <h3 class="text-base font-semibold break-words">
                {viewing.title}
              </h3>
              <p class="text-muted-foreground text-xs">
                {m.docs_revision_label({ rev: viewing.rev })}
                ·
                {viewing.userName ?? m.docs_unknown_user()}
                ·
                {formatDateTime(viewing.createdAt, { timeZone })}
              </p>
            </div>
            <!-- Keyboard users have to be able to focus and scroll the source. -->
            <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
            <pre
              class="bg-muted/50 max-h-[55svh] overflow-auto rounded-lg border p-3 font-mono text-xs leading-relaxed break-words whitespace-pre-wrap"
              tabindex="0"
              aria-label={m.docs_revision_source()}>{viewing.bodyMd ||
                m.docs_revision_empty()}</pre>
          {/if}
        </div>
      {:else if phase === "loading" || phase === "idle"}
        <div
          class="flex flex-col gap-3"
          role="status"
          aria-label={m.common_loading()}
        >
          {#each [0, 1, 2, 3] as n (n)}
            <Skeleton class="h-14 w-full rounded-lg" />
          {/each}
        </div>
      {:else if phase === "error"}
        <div class="flex flex-col items-start gap-3">
          <FormAlert message={loadError} />
          <Button variant="outline" onclick={load}>{m.common_retry()}</Button>
        </div>
      {:else}
        <ul class="flex flex-col gap-2">
          {#each items as revision (revision.rev)}
            {@const current = revision.rev === currentRev}
            <li>
              <button
                type="button"
                class={cn(
                  "hover:bg-accent/50 focus-visible:ring-ring/50 flex w-full flex-col gap-1 rounded-lg border p-3 text-start transition-colors outline-none focus-visible:ring-[3px]",
                  current && "border-brand/40 bg-brand/5",
                )}
                onclick={() => view(revision.rev)}
              >
                <span class="flex items-center gap-2">
                  <span class="text-sm font-medium tabular-nums">
                    {m.docs_revision_label({ rev: revision.rev })}
                  </span>
                  {#if current}
                    <Badge class="bg-brand text-brand-foreground"
                      >{m.docs_revision_current()}</Badge
                    >
                  {/if}
                  <span
                    class="text-muted-foreground ms-auto text-xs tabular-nums"
                  >
                    {formatBytes(revision.size)}
                  </span>
                </span>
                <span class="truncate text-sm">{revision.title}</span>
                <span class="text-muted-foreground text-xs">
                  {revision.userName ?? m.docs_unknown_user()} · {formatDateTime(
                    revision.createdAt,
                    { timeZone },
                  )}
                </span>
              </button>
            </li>
          {/each}
        </ul>
      {/if}
    </div>

    {#if viewing && canWrite}
      <Sheet.Footer class="border-t">
        {#if viewing.rev === currentRev}
          <p class="text-muted-foreground text-sm">
            {m.docs_revision_is_current()}
          </p>
        {:else}
          <Button size="lg" onclick={() => (restoreOpen = true)}>
            <RotateCcwIcon />{m.docs_restore()}
          </Button>
        {/if}
      </Sheet.Footer>
    {/if}
  </Sheet.Content>
</Sheet.Root>

<ConfirmDialog
  bind:open={restoreOpen}
  title={m.docs_restore_title({ rev: viewing?.rev ?? 0 })}
  description={m.docs_restore_description()}
  confirmLabel={m.docs_restore()}
  pendingLabel={m.docs_restoring()}
  onconfirm={restore}
/>
