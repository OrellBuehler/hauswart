<script lang="ts">
  import { invalidateAll } from "$app/navigation";
  import CalendarDaysIcon from "@lucide/svelte/icons/calendar-days";
  import PlusIcon from "@lucide/svelte/icons/plus";
  import { toast } from "svelte-sonner";
  import { api } from "$lib/api/browser";
  import { endpoints } from "$lib/api/registry";
  import {
    MAX_FEEDS_PER_USER,
    type CalendarFeed,
  } from "$lib/api/schemas/share";
  import ConfirmDialog from "$lib/components/app/confirm-dialog.svelte";
  import EmptyState from "$lib/components/app/empty-state.svelte";
  import CalendarHowto from "$lib/components/share/calendar-howto.svelte";
  import FeedFormDialog from "$lib/components/share/feed-form-dialog.svelte";
  import FeedRow from "$lib/components/share/feed-row.svelte";
  import FeedSubscribeDialog from "$lib/components/share/feed-subscribe-dialog.svelte";
  import { Button } from "$lib/components/ui/button/index.js";
  import * as Card from "$lib/components/ui/card/index.js";
  import { m } from "$lib/paraglide/messages";
  import type { PageProps } from "./$types";

  let { data }: PageProps = $props();

  let formOpen = $state(false);
  let editing = $state<CalendarFeed | undefined>();
  let subscribeOpen = $state(false);
  let subscribeId = $state<string | undefined>();
  let rotateOpen = $state(false);
  let deleteOpen = $state(false);
  let target = $state<CalendarFeed | undefined>();

  const full = $derived(data.feeds.length >= MAX_FEEDS_PER_USER);
  const subscribing = $derived(data.feeds.find((f) => f.id === subscribeId));

  function create() {
    editing = undefined;
    formOpen = true;
  }

  function edit(feed: CalendarFeed) {
    editing = feed;
    formOpen = true;
  }

  function showQr(feed: CalendarFeed) {
    subscribeId = feed.id;
    subscribeOpen = true;
  }

  async function saved(feed: CalendarFeed, created: boolean) {
    await invalidateAll();
    if (created) showQr(feed);
  }

  function askRotate(feed: CalendarFeed) {
    target = feed;
    rotateOpen = true;
  }

  function askDelete(feed: CalendarFeed) {
    target = feed;
    deleteOpen = true;
  }

  async function rotate() {
    if (!target) return;
    const feed = await api.call(endpoints.calendarFeedsRotate, {
      params: { id: target.id },
    });
    toast.success(m.feeds_rotated_toast({ name: feed.name }));
    await invalidateAll();
    showQr(feed);
  }

  async function remove() {
    if (!target) return;
    const { id, name } = target;
    await api.call(endpoints.calendarFeedsDelete, { params: { id } });
    toast.success(m.feeds_deleted_toast({ name }));
    await invalidateAll();
  }
</script>

<svelte:head>
  <title>{m.feeds_title()} · {m.settings_title()} · {m.app_name()}</title>
</svelte:head>

<div class="flex flex-col gap-6">
  <Card.Root>
    <Card.Header>
      <Card.Title>{m.feeds_title()}</Card.Title>
      <Card.Description>{m.feeds_description()}</Card.Description>
    </Card.Header>
    <Card.Content>
      {#if data.feeds.length === 0}
        <EmptyState
          icon={CalendarDaysIcon}
          title={m.feeds_empty_title()}
          description={m.feeds_empty_body()}
        >
          {#snippet actions()}
            <Button onclick={create}><PlusIcon />{m.feeds_create()}</Button>
          {/snippet}
        </EmptyState>
      {:else}
        <div class="mb-4 flex flex-wrap items-center gap-x-4 gap-y-2">
          <Button size="sm" onclick={create} disabled={full}>
            <PlusIcon />{m.feeds_create()}
          </Button>
          <p class="text-muted-foreground text-xs tabular-nums">
            {full
              ? m.feeds_limit_reached()
              : m.feeds_count({
                  count: data.feeds.length,
                  max: MAX_FEEDS_PER_USER,
                })}
          </p>
        </div>
        <ul class="divide-y rounded-lg border">
          {#each data.feeds as feed (feed.id)}
            <FeedRow
              {feed}
              timeZone={data.timeZone}
              onedit={() => edit(feed)}
              onqr={() => showQr(feed)}
              onrotate={() => askRotate(feed)}
              ondelete={() => askDelete(feed)}
            />
          {/each}
        </ul>
      {/if}
    </Card.Content>
  </Card.Root>

  <Card.Root>
    <Card.Header>
      <Card.Title>{m.feeds_howto_title()}</Card.Title>
      <Card.Description>{m.feeds_howto_description()}</Card.Description>
    </Card.Header>
    <Card.Content>
      <CalendarHowto />
    </Card.Content>
  </Card.Root>
</div>

<FeedFormDialog bind:open={formOpen} feed={editing} onsaved={saved} />
<FeedSubscribeDialog bind:open={subscribeOpen} feed={subscribing} />

<ConfirmDialog
  bind:open={rotateOpen}
  title={m.feeds_rotate_title()}
  description={m.feeds_rotate_description({ name: target?.name ?? "" })}
  confirmLabel={m.feeds_rotate_confirm()}
  pendingLabel={m.feeds_rotate_pending()}
  destructive
  onconfirm={rotate}
/>

<ConfirmDialog
  bind:open={deleteOpen}
  title={m.feeds_delete_title()}
  description={m.feeds_delete_description({ name: target?.name ?? "" })}
  confirmLabel={m.feeds_delete_confirm()}
  pendingLabel={m.common_deleting()}
  destructive
  onconfirm={remove}
/>
