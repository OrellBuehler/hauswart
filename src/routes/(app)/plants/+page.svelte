<script lang="ts">
  import { resolve } from "$app/paths";
  import DropletsIcon from "@lucide/svelte/icons/droplets";
  import LeafIcon from "@lucide/svelte/icons/leaf";
  import LoaderCircleIcon from "@lucide/svelte/icons/loader-circle";
  import PlusIcon from "@lucide/svelte/icons/plus";
  import SproutIcon from "@lucide/svelte/icons/sprout";
  import type { Hint } from "$lib/api/schemas/hints";
  import type { Task } from "$lib/api/schemas/tasks";
  import { completeWithUndo } from "$lib/assets/complete";
  import { newAssetHref, newTaskHref } from "$lib/assets/links";
  import { sortTasks } from "$lib/assets/tasks";
  import AssetPhoto from "$lib/components/assets/asset-photo.svelte";
  import DueBadge from "$lib/components/assets/due-badge.svelte";
  import EmptyState from "$lib/components/app/empty-state.svelte";
  import PageHeader from "$lib/components/app/page-header.svelte";
  import { Button } from "$lib/components/ui/button/index.js";
  import { hintKindIcons, hintTones } from "$lib/hints/labels";
  import { cn } from "$lib/utils";
  import { m } from "$lib/paraglide/messages";
  import type { PageProps } from "./$types";

  let { data }: PageProps = $props();

  let watering = $state<string | null>(null);

  const waterTasks = $derived.by(() => {
    const byAsset: Record<string, Task> = {};
    for (const task of sortTasks(data.tasks)) {
      if (task.assetId && !(task.assetId in byAsset)) {
        byAsset[task.assetId] = task;
      }
    }
    return byAsset;
  });

  const hintsByAsset = $derived.by(() => {
    const byAsset: Record<string, Hint[]> = {};
    for (const hint of data.hints) {
      (byAsset[hint.assetId] ??= []).push(hint);
    }
    return byAsset;
  });

  const plants = $derived(
    [...data.plants].sort((a, b) => {
      const rank = (id: string) => {
        const status = waterTasks[id]?.state?.status;
        return status === "overdue"
          ? 0
          : status === "due" || status === "open"
            ? 1
            : 2;
      };
      return rank(a.id) - rank(b.id) || a.name.localeCompare(b.name);
    }),
  );

  async function water(plantId: string, name: string) {
    const task = waterTasks[plantId];
    if (!task || watering) return;
    watering = plantId;
    await completeWithUndo(task, m.plants_watered_toast({ name }));
    watering = null;
  }
</script>

<svelte:head>
  <title>{m.nav_plants()} · {m.app_name()}</title>
</svelte:head>

<div class="flex flex-col gap-6">
  <PageHeader title={m.nav_plants()} description={m.plants_description()}>
    {#snippet actions()}
      <Button href={newAssetHref("plant")}>
        <PlusIcon />{m.plants_create()}
      </Button>
    {/snippet}
  </PageHeader>

  {#if plants.length === 0}
    <EmptyState
      icon={SproutIcon}
      title={m.plants_empty_title()}
      description={m.plants_empty_body()}
    >
      {#snippet actions()}
        <Button href={newAssetHref("plant")}>
          <PlusIcon />{m.plants_create()}
        </Button>
      {/snippet}
    </EmptyState>
  {:else}
    <ul class="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {#each plants as plant (plant.id)}
        {@const task = waterTasks[plant.id]}
        <li
          class="bg-card shadow-card relative flex min-w-0 flex-col gap-4 rounded-xl border p-4"
        >
          <div class="flex min-w-0 items-start gap-3">
            {#if plant.photoUrl}
              <AssetPhoto
                kind="plant"
                photoUrl={plant.photoUrl}
                class="size-14 rounded-xl"
              />
            {:else}
              <span
                class="bg-success/10 text-success flex size-14 shrink-0 items-center justify-center rounded-xl"
                aria-hidden="true"
              >
                <LeafIcon class="size-7" />
              </span>
            {/if}
            <div class="min-w-0 flex-1">
              <a
                href={resolve(`/assets/${plant.id}`)}
                class="focus-visible:ring-ring/50 focus-visible:after:ring-ring/50 block truncate rounded-sm font-medium outline-none after:absolute after:inset-0 after:rounded-xl focus-visible:after:ring-[3px]"
              >
                {plant.name}
              </a>
              {#if plant.species}
                <p class="text-muted-foreground truncate text-sm italic">
                  {plant.species}
                </p>
              {/if}
              <p class="text-muted-foreground mt-0.5 truncate text-xs">
                {[plant.roomName, plant.light].filter(Boolean).join(" · ") ||
                  m.plants_no_room()}
              </p>
            </div>
          </div>
          {#if hintsByAsset[plant.id]?.length}
            {@const hints = hintsByAsset[plant.id]}
            <div class="flex flex-col gap-1.5">
              <p class="text-muted-foreground text-xs font-medium">
                {m.plants_hints()}
              </p>
              <ul class="flex flex-col gap-1">
                {#each hints.slice(0, 2) as hint (hint.id)}
                  {@const HintIcon = hintKindIcons[hint.kind]}
                  <li class="flex items-start gap-2 text-sm">
                    <HintIcon
                      class={cn(
                        "mt-0.5 size-4 shrink-0",
                        hintTones[hint.kind].text,
                      )}
                      aria-hidden="true"
                    />
                    <span class="line-clamp-2 min-w-0 break-words"
                      >{hint.title}</span
                    >
                  </li>
                {/each}
              </ul>
              {#if hints.length > 2}
                <p class="text-muted-foreground text-xs">
                  {m.plants_hints_more({ count: hints.length - 2 })}
                </p>
              {/if}
            </div>
          {/if}
          <div
            class="relative z-10 mt-auto flex flex-wrap items-center justify-between gap-x-3 gap-y-2 border-t pt-3"
          >
            {#if task}
              <DueBadge state={task.state} />
              <Button
                size="lg"
                disabled={watering !== null}
                aria-label={m.plants_water_aria({ name: plant.name })}
                onclick={() => water(plant.id, plant.name)}
              >
                {#if watering === plant.id}
                  <LoaderCircleIcon class="animate-spin" />
                {:else}
                  <DropletsIcon />
                {/if}
                {m.plants_water()}
              </Button>
            {:else}
              <span class="text-muted-foreground text-xs"
                >{m.plants_no_plan()}</span
              >
              <Button href={newTaskHref(plant.id)} size="sm" variant="outline">
                {m.plants_add_plan()}
              </Button>
            {/if}
          </div>
        </li>
      {/each}
    </ul>
  {/if}
</div>
