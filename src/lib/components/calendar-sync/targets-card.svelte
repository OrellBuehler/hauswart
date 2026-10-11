<script lang="ts">
  import { resolve } from "$app/paths";
  import { invalidateAll } from "$app/navigation";
  import CalendarSyncIcon from "@lucide/svelte/icons/calendar-sync";
  import PlugZapIcon from "@lucide/svelte/icons/plug-zap";
  import PlusIcon from "@lucide/svelte/icons/plus";
  import { CALENDAR_PROVIDERS } from "$lib/api/enums";
  import type { CalendarTarget } from "$lib/api/schemas/calendar-sync";
  import type { Integration } from "$lib/api/schemas/integrations";
  import EmptyState from "$lib/components/app/empty-state.svelte";
  import { Button } from "$lib/components/ui/button/index.js";
  import * as Card from "$lib/components/ui/card/index.js";
  import { awaitsFirstRun } from "$lib/calendar-sync/health";
  import {
    creatableProviders,
    providerUsable,
  } from "$lib/calendar-sync/providers";
  import { m } from "$lib/paraglide/messages";
  import TargetDeleteDialog from "./target-delete-dialog.svelte";
  import TargetFormDialog from "./target-form-dialog.svelte";
  import TargetRow from "./target-row.svelte";

  let {
    targets,
    integrations,
    isAdmin,
    timeZone,
  }: {
    targets: CalendarTarget[];
    integrations: Integration[];
    isAdmin: boolean;
    timeZone: string | undefined;
  } = $props();

  /** A new target is written by the server within seconds; the list looks again a few times so the first result shows up. */
  const FIRST_RUN_POLL_MS = 3000;
  const FIRST_RUN_POLLS = 10;

  let formOpen = $state(false);
  let editing = $state<CalendarTarget | undefined>();
  let deleteOpen = $state(false);
  let removing = $state<CalendarTarget | undefined>();

  const providers = $derived(creatableProviders(integrations, isAdmin));
  const anyUsable = $derived(
    CALENDAR_PROVIDERS.some((kind) => providerUsable(integrations, kind)),
  );
  const showReadonlyNote = $derived(
    targets.length > 0 && targets.some((t) => !t.canManage) && !isAdmin,
  );
  const waitingForFirstRun = $derived(
    targets.some((t) =>
      awaitsFirstRun(t, providerUsable(integrations, t.provider)),
    ),
  );

  $effect(() => {
    if (!waitingForFirstRun) return;
    let polls = 0;
    const handle = setInterval(() => {
      polls += 1;
      if (polls > FIRST_RUN_POLLS) {
        clearInterval(handle);
        return;
      }
      void invalidateAll();
    }, FIRST_RUN_POLL_MS);
    return () => clearInterval(handle);
  });

  function add() {
    editing = undefined;
    formOpen = true;
  }

  function edit(target: CalendarTarget) {
    editing = target;
    formOpen = true;
  }

  function askRemove(target: CalendarTarget) {
    removing = target;
    deleteOpen = true;
  }

  async function reload() {
    await invalidateAll();
  }
</script>

<Card.Root id="calendar-targets" class="scroll-mt-20">
  <Card.Header>
    <Card.Title>{m.caltargets_title()}</Card.Title>
    <Card.Description>{m.caltargets_description()}</Card.Description>
  </Card.Header>
  <Card.Content>
    {#if targets.length === 0}
      {#if !anyUsable}
        <EmptyState
          icon={PlugZapIcon}
          title={m.caltargets_noconn_title()}
          description={isAdmin
            ? m.caltargets_noconn_body_admin()
            : m.caltargets_noconn_body_member()}
        >
          {#snippet actions()}
            <Button href={resolve("/settings/integrations")}>
              {isAdmin
                ? m.caltargets_noconn_action_admin()
                : m.caltargets_noconn_action_member()}
            </Button>
          {/snippet}
        </EmptyState>
      {:else}
        <EmptyState
          icon={CalendarSyncIcon}
          title={m.caltargets_empty_title()}
          description={providers.length > 0
            ? m.caltargets_empty_body_admin()
            : m.caltargets_empty_body_member()}
        >
          {#snippet actions()}
            {#if providers.length > 0}
              <Button onclick={add}><PlusIcon />{m.caltargets_add()}</Button>
            {/if}
          {/snippet}
        </EmptyState>
      {/if}
    {:else}
      {#if providers.length > 0}
        <div class="mb-4">
          <Button size="sm" onclick={add}>
            <PlusIcon />{m.caltargets_add()}
          </Button>
        </div>
      {/if}
      <ul class="divide-y rounded-lg border">
        {#each targets as target (target.id)}
          <TargetRow
            {target}
            {timeZone}
            connectionUsable={providerUsable(integrations, target.provider)}
            onedit={() => edit(target)}
            ondelete={() => askRemove(target)}
            onchanged={reload}
          />
        {/each}
      </ul>
      {#if showReadonlyNote}
        <p class="text-muted-foreground mt-4 text-xs text-pretty">
          {m.caltargets_readonly_note()}
        </p>
      {/if}
    {/if}
  </Card.Content>
</Card.Root>

<TargetFormDialog
  bind:open={formOpen}
  target={editing}
  {providers}
  {targets}
  onsaved={reload}
/>
<TargetDeleteDialog
  bind:open={deleteOpen}
  target={removing}
  onremoved={reload}
/>
