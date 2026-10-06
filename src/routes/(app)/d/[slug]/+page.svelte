<script lang="ts">
  import { resolve } from "$app/paths";
  import CheckIcon from "@lucide/svelte/icons/check";
  import CircleCheckBigIcon from "@lucide/svelte/icons/circle-check-big";
  import CompassIcon from "@lucide/svelte/icons/compass";
  import LoaderCircleIcon from "@lucide/svelte/icons/loader-circle";
  import PlusIcon from "@lucide/svelte/icons/plus";
  import QrCodeIcon from "@lucide/svelte/icons/qr-code";
  import type { Task } from "$lib/api/schemas/tasks";
  import { completeWithUndo } from "$lib/assets/complete";
  import { kindLabels } from "$lib/assets/kinds";
  import { newTaskHref } from "$lib/assets/links";
  import { isActionable } from "$lib/assets/tasks";
  import AssetPhoto from "$lib/components/assets/asset-photo.svelte";
  import DueBadge from "$lib/components/assets/due-badge.svelte";
  import EmptyState from "$lib/components/app/empty-state.svelte";
  import HintCallout from "$lib/components/hints/hint-callout.svelte";
  import { Button } from "$lib/components/ui/button/index.js";
  import { formatDay } from "$lib/format";
  import { m } from "$lib/paraglide/messages";
  import type { PageProps } from "./$types";

  let { data }: PageProps = $props();

  let busy = $state<string | null>(null);

  const found = $derived(data.found);
  const open = $derived(found?.tasks.filter(isActionable) ?? []);
  const others = $derived(found?.tasks.filter((t) => !isActionable(t)) ?? []);
  const pinned = $derived(found?.hints.filter((h) => h.pinned) ?? []);
  const unpinned = $derived(found?.hints.filter((h) => !h.pinned) ?? []);

  async function done(task: Task) {
    if (busy) return;
    busy = task.id;
    await completeWithUndo(task, m.qr_done_toast({ title: task.title }), "qr");
    busy = null;
  }
</script>

<svelte:head>
  <title
    >{found ? found.asset.name : m.qr_not_found_title()} · {m.app_name()}</title
  >
</svelte:head>

{#if !found}
  <div class="mx-auto flex min-h-[60svh] max-w-lg flex-col justify-center">
    <EmptyState
      icon={CompassIcon}
      title={m.qr_not_found_title()}
      description={m.qr_not_found_body()}
    >
      {#snippet actions()}
        <Button href={resolve("/inventory")}>{m.nav_inventory()}</Button>
        <Button href={resolve("/")} variant="outline"
          >{m.common_back_home()}</Button
        >
      {/snippet}
    </EmptyState>
  </div>
{:else}
  <div class="mx-auto flex max-w-md flex-col gap-6">
    <header class="flex items-center gap-3">
      <AssetPhoto
        kind={found.asset.kind}
        photoUrl={found.asset.photoUrl}
        class="size-14 rounded-xl"
      />
      <div class="min-w-0">
        <p class="text-muted-foreground flex items-center gap-1.5 text-xs">
          <QrCodeIcon class="size-3.5" aria-hidden="true" />
          {kindLabels[found.asset.kind]()}
        </p>
        <h1 class="text-2xl font-semibold tracking-tight text-balance">
          {found.asset.name}
        </h1>
        {#if found.asset.roomName}
          <p class="text-muted-foreground text-sm">{found.asset.roomName}</p>
        {/if}
      </div>
    </header>

    {#if pinned.length > 0}
      <section class="flex flex-col gap-3" aria-labelledby="qr-hints">
        <h2 id="qr-hints" class="text-sm font-semibold">
          {m.qr_hints_title()}
        </h2>
        <ul class="flex flex-col gap-3">
          {#each pinned as hint (hint.id)}
            <HintCallout {hint} prominent />
          {/each}
        </ul>
      </section>
    {/if}

    <section class="flex flex-col gap-3" aria-labelledby="qr-open">
      <h2 id="qr-open" class="text-sm font-semibold">{m.qr_open_title()}</h2>
      {#if open.length === 0}
        <div
          class="text-muted-foreground flex items-center gap-3 rounded-xl border border-dashed p-4 text-sm"
        >
          <CircleCheckBigIcon
            class="text-success size-5 shrink-0"
            aria-hidden="true"
          />
          {found.tasks.length === 0 ? m.qr_no_tasks() : m.qr_all_done()}
        </div>
      {:else}
        <ul class="flex flex-col gap-3">
          {#each open as task (task.id)}
            <li
              class="bg-card shadow-card flex flex-col gap-3 rounded-xl border p-4"
            >
              <div class="flex flex-col gap-1.5">
                <a
                  href={resolve(`/tasks/${task.id}` as "/tasks")}
                  class="font-medium underline-offset-4 hover:underline"
                >
                  {task.title}
                </a>
                <DueBadge state={task.state} />
              </div>
              <Button
                size="lg"
                class="h-12 w-full text-base"
                disabled={busy !== null}
                onclick={() => done(task)}
              >
                {#if busy === task.id}
                  <LoaderCircleIcon class="animate-spin" />
                {:else}
                  <CheckIcon />
                {/if}
                {m.qr_done()}
              </Button>
            </li>
          {/each}
        </ul>
      {/if}
    </section>

    {#if others.length > 0}
      <section class="flex flex-col gap-3" aria-labelledby="qr-others">
        <h2 id="qr-others" class="text-sm font-semibold">
          {m.qr_other_title()}
        </h2>
        <ul class="divide-y rounded-xl border">
          {#each others as task (task.id)}
            <li class="flex items-center justify-between gap-3 px-4 py-3">
              <div class="flex min-w-0 flex-col gap-1">
                <a
                  href={resolve(`/tasks/${task.id}` as "/tasks")}
                  class="truncate text-sm font-medium underline-offset-4 hover:underline"
                >
                  {task.title}
                </a>
                <DueBadge state={task.state} />
              </div>
              <Button
                size="sm"
                variant="outline"
                disabled={busy !== null}
                aria-label={m.qr_done_anyway_aria({ title: task.title })}
                onclick={() => done(task)}
              >
                {#if busy === task.id}
                  <LoaderCircleIcon class="animate-spin" />
                {:else}
                  <CheckIcon />
                {/if}
                {m.qr_done()}
              </Button>
            </li>
          {/each}
        </ul>
      </section>
    {/if}

    {#if unpinned.length > 0}
      <section class="flex flex-col gap-3" aria-labelledby="qr-more-hints">
        <h2 id="qr-more-hints" class="text-sm font-semibold">
          {pinned.length > 0 ? m.qr_more_hints_title() : m.qr_hints_title()}
        </h2>
        <ul class="flex flex-col gap-2">
          {#each unpinned as hint (hint.id)}
            <HintCallout {hint} />
          {/each}
        </ul>
      </section>
    {/if}

    {#if found.completions.length > 0}
      <section class="flex flex-col gap-3" aria-labelledby="qr-history">
        <h2 id="qr-history" class="text-sm font-semibold">
          {m.qr_history_title()}
        </h2>
        <ul class="divide-y rounded-xl border text-sm">
          {#each found.completions as completion (completion.id)}
            <li class="flex items-baseline justify-between gap-3 px-4 py-2.5">
              <span class="min-w-0">
                <span class="block truncate">{completion.taskTitle}</span>
                {#if completion.userName}
                  <span class="text-muted-foreground block truncate text-xs">
                    {completion.userName}
                  </span>
                {/if}
              </span>
              <span class="text-muted-foreground shrink-0 text-xs tabular-nums">
                {formatDay(completion.completedDate)}
              </span>
            </li>
          {/each}
        </ul>
      </section>
    {/if}

    <div class="flex flex-col gap-2">
      <Button href={resolve(`/assets/${found.asset.id}`)} variant="outline">
        {m.qr_full_page()}
      </Button>
      <Button
        href={newTaskHref(found.asset.id)}
        variant="ghost"
        class="text-muted-foreground"
      >
        <PlusIcon />{m.asset_add_task()}
      </Button>
    </div>
  </div>
{/if}
