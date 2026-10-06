<script lang="ts">
  import CircleHelpIcon from "@lucide/svelte/icons/circle-help";
  import LoaderCircleIcon from "@lucide/svelte/icons/loader-circle";
  import TriangleAlertIcon from "@lucide/svelte/icons/triangle-alert";
  import type { ExternalEntity } from "$lib/connections/types";
  import {
    ENTITY_ID_PATTERN,
    formatReading,
    lookupEntity,
  } from "$lib/connections/entities";
  import {
    homeAssistantOf,
    isUsable,
    loadIntegrations,
  } from "$lib/connections/connection";
  import { m } from "$lib/paraglide/messages";
  import { cn } from "$lib/utils";

  let {
    entityId,
    onresolve,
    class: className,
  }: {
    entityId: string;
    /** Called with what Home Assistant knows about the id (null: unknown there, undefined: not asked or not answered). */
    onresolve?: (entity: ExternalEntity | null | undefined) => void;
    class?: string;
  } = $props();

  type View =
    | { kind: "idle" }
    | { kind: "loading" }
    | { kind: "found"; entity: ExternalEntity }
    | { kind: "missing" }
    | { kind: "failed" };

  let view = $state<View>({ kind: "idle" });
  let sequence = 0;

  $effect(() => {
    const id = entityId.trim();
    const ticket = ++sequence;
    if (!ENTITY_ID_PATTERN.test(id)) {
      view = { kind: "idle" };
      onresolve?.(undefined);
      return;
    }
    view = { kind: "loading" };
    const handle = setTimeout(async () => {
      try {
        const list = await loadIntegrations();
        if (ticket !== sequence) return;
        if (!isUsable(homeAssistantOf(list))) {
          view = { kind: "idle" };
          onresolve?.(undefined);
          return;
        }
        const entity = await lookupEntity(id);
        if (ticket !== sequence) return;
        view = entity ? { kind: "found", entity } : { kind: "missing" };
        onresolve?.(entity);
      } catch (err) {
        if (ticket !== sequence) return;
        console.warn("entity lookup failed", err);
        view = { kind: "failed" };
        onresolve?.(undefined);
      }
    }, 350);
    return () => clearTimeout(handle);
  });
</script>

<div aria-live="polite" class={cn("min-h-4 text-xs", className)}>
  {#if view.kind === "loading"}
    <p class="text-muted-foreground flex items-center gap-1.5">
      <LoaderCircleIcon class="size-3.5 animate-spin" aria-hidden="true" />
      {m.entity_reading_loading()}
    </p>
  {:else if view.kind === "found"}
    <p
      class="text-muted-foreground flex flex-wrap items-center gap-x-1.5 gap-y-0.5"
    >
      <span class="bg-success size-1.5 shrink-0 rounded-full" aria-hidden="true"
      ></span>
      <span class="text-foreground min-w-0 font-medium break-words"
        >{view.entity.name}</span
      >
      <span aria-hidden="true">·</span>
      <span>
        {m.entity_reading_now()}
        <span class="text-foreground font-medium tabular-nums"
          >{formatReading(view.entity)}</span
        >
      </span>
      {#if view.entity.area}
        <span aria-hidden="true">·</span>
        <span>{view.entity.area}</span>
      {/if}
    </p>
  {:else if view.kind === "missing"}
    <p class="text-warning flex items-start gap-1.5 text-pretty">
      <TriangleAlertIcon class="mt-px size-3.5 shrink-0" aria-hidden="true" />
      {m.entity_reading_missing()}
    </p>
  {:else if view.kind === "failed"}
    <p class="text-muted-foreground flex items-start gap-1.5 text-pretty">
      <CircleHelpIcon class="mt-px size-3.5 shrink-0" aria-hidden="true" />
      {m.entity_reading_failed()}
    </p>
  {/if}
</div>
