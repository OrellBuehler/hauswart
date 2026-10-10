<script lang="ts">
  import { invalidateAll } from "$app/navigation";
  import { resolve } from "$app/paths";
  import BookOpenIcon from "@lucide/svelte/icons/book-open";
  import ContactIcon from "@lucide/svelte/icons/contact";
  import EyeIcon from "@lucide/svelte/icons/eye";
  import LinkIcon from "@lucide/svelte/icons/link-2";
  import PlusIcon from "@lucide/svelte/icons/plus";
  import SirenIcon from "@lucide/svelte/icons/siren";
  import { toast } from "svelte-sonner";
  import { api } from "$lib/api/browser";
  import { endpoints } from "$lib/api/registry";
  import type { CreatedGuestLink, GuestLink } from "$lib/api/schemas/share";
  import ConfirmDialog from "$lib/components/app/confirm-dialog.svelte";
  import EmptyState from "$lib/components/app/empty-state.svelte";
  import GuestLinkFormDialog from "$lib/components/share/guest-link-form-dialog.svelte";
  import GuestLinkRevealDialog from "$lib/components/share/guest-link-reveal-dialog.svelte";
  import GuestLinkRow from "$lib/components/share/guest-link-row.svelte";
  import { Button } from "$lib/components/ui/button/index.js";
  import * as Card from "$lib/components/ui/card/index.js";
  import { m } from "$lib/paraglide/messages";
  import type { PageProps } from "./$types";

  let { data }: PageProps = $props();

  let formOpen = $state(false);
  let editing = $state<GuestLink | undefined>();
  let revealOpen = $state(false);
  let revealed = $state<CreatedGuestLink | undefined>();
  let revealedPin = $state<string | null>(null);
  let revealedRotated = $state(false);
  let rotateOpen = $state(false);
  let revokeOpen = $state(false);
  let target = $state<GuestLink | undefined>();

  const running = $derived(
    data.links.filter((l) => l.status === "active" || l.status === "scheduled"),
  );
  const ended = $derived(
    data.links.filter((l) => l.status === "expired" || l.status === "revoked"),
  );

  function create() {
    editing = undefined;
    formOpen = true;
  }

  function edit(link: GuestLink) {
    editing = link;
    formOpen = true;
  }

  async function created(link: CreatedGuestLink, pin: string | null) {
    revealed = link;
    revealedPin = pin;
    revealedRotated = false;
    formOpen = false;
    revealOpen = true;
    await invalidateAll();
  }

  function askRotate(link: GuestLink) {
    target = link;
    rotateOpen = true;
  }

  function askRevoke(link: GuestLink) {
    target = link;
    revokeOpen = true;
  }

  async function rotate() {
    if (!target) return;
    const link = await api.call(endpoints.guestLinksRotate, {
      params: { id: target.id },
    });
    toast.success(m.glinks_rotated_toast({ label: link.label }));
    revealed = link;
    revealedPin = null;
    revealedRotated = true;
    revealOpen = true;
    await invalidateAll();
  }

  async function revoke() {
    if (!target) return;
    const { id, label } = target;
    await api.call(endpoints.guestLinksRevoke, { params: { id } });
    toast.success(m.glinks_revoked_toast({ label }));
    await invalidateAll();
  }

  const flagPlaces = [
    {
      href: "/docs",
      icon: BookOpenIcon,
      title: () => m.glinks_where_docs(),
      body: () => m.glinks_where_docs_body(),
    },
    {
      href: "/contacts",
      icon: ContactIcon,
      title: () => m.glinks_where_contacts(),
      body: () => m.glinks_where_contacts_body(),
    },
    {
      href: "/inventory",
      icon: SirenIcon,
      title: () => m.glinks_where_devices(),
      body: () => m.glinks_where_devices_body(),
    },
  ] as const;
</script>

<svelte:head>
  <title>{m.glinks_title()} · {m.settings_title()} · {m.app_name()}</title>
</svelte:head>

<div class="flex flex-col gap-6">
  <Card.Root>
    <Card.Header>
      <Card.Title>{m.glinks_title()}</Card.Title>
      <Card.Description>{m.glinks_description()}</Card.Description>
    </Card.Header>
    <Card.Content class="flex flex-col gap-6">
      {#if data.links.length === 0}
        <EmptyState
          icon={LinkIcon}
          title={m.glinks_empty_title()}
          description={m.glinks_empty_body()}
        >
          {#snippet actions()}
            <Button onclick={create}><PlusIcon />{m.glinks_create()}</Button>
          {/snippet}
        </EmptyState>
      {:else}
        <div class="flex">
          <Button size="sm" onclick={create}>
            <PlusIcon />{m.glinks_create()}
          </Button>
        </div>
        {#if running.length > 0}
          <section class="flex flex-col gap-2" aria-labelledby="glinks-running">
            <h2
              id="glinks-running"
              class="text-muted-foreground text-xs font-medium tracking-wide uppercase"
            >
              {m.glinks_group_running()}
            </h2>
            <ul class="divide-y rounded-lg border">
              {#each running as link (link.id)}
                <GuestLinkRow
                  {link}
                  timeZone={data.timeZone}
                  onedit={() => edit(link)}
                  onrotate={() => askRotate(link)}
                  onrevoke={() => askRevoke(link)}
                />
              {/each}
            </ul>
          </section>
        {:else}
          <p class="text-muted-foreground text-sm">{m.glinks_none_running()}</p>
        {/if}
        {#if ended.length > 0}
          <section class="flex flex-col gap-2" aria-labelledby="glinks-ended">
            <h2
              id="glinks-ended"
              class="text-muted-foreground text-xs font-medium tracking-wide uppercase"
            >
              {m.glinks_group_ended()}
            </h2>
            <ul class="divide-y rounded-lg border">
              {#each ended as link (link.id)}
                <GuestLinkRow
                  {link}
                  timeZone={data.timeZone}
                  onedit={() => edit(link)}
                  onrotate={() => askRotate(link)}
                  onrevoke={() => askRevoke(link)}
                />
              {/each}
            </ul>
          </section>
        {/if}
      {/if}
    </Card.Content>
  </Card.Root>

  <Card.Root>
    <Card.Header>
      <Card.Title class="flex items-center gap-2">
        <EyeIcon class="size-4" aria-hidden="true" />{m.glinks_info_title()}
      </Card.Title>
      <Card.Description>{m.glinks_info_description()}</Card.Description>
    </Card.Header>
    <Card.Content class="flex flex-col gap-4">
      <ul
        class="text-muted-foreground flex list-disc flex-col gap-1.5 ps-5 text-sm text-pretty"
      >
        <li>{m.glinks_info_both()}</li>
        <li>{m.glinks_info_secrets()}</li>
        <li>{m.glinks_info_files()}</li>
        <li>{m.glinks_info_dead()}</li>
      </ul>
      <ul class="grid gap-3 md:grid-cols-3">
        {#each flagPlaces as place (place.href)}
          <li class="flex flex-col gap-1.5 rounded-lg border p-3">
            <span class="flex items-center gap-2 text-sm font-medium">
              <place.icon
                class="text-muted-foreground size-4"
                aria-hidden="true"
              />
              {place.title()}
            </span>
            <p class="text-muted-foreground text-xs text-pretty">
              {place.body()}
            </p>
            <a
              href={resolve(place.href)}
              class="text-brand mt-auto inline-flex min-h-10 items-center self-start text-xs font-medium underline underline-offset-4"
            >
              {m.glinks_where_open()}
            </a>
          </li>
        {/each}
      </ul>
      <p class="text-muted-foreground text-xs text-pretty">
        {m.glinks_info_emergency()}
        <a
          href={resolve("/emergency")}
          class="text-brand font-medium underline underline-offset-4 pointer-coarse:inline-flex pointer-coarse:min-h-10 pointer-coarse:items-center"
        >
          {m.glinks_info_emergency_link()}
        </a>
      </p>
    </Card.Content>
  </Card.Root>
</div>

<GuestLinkFormDialog
  bind:open={formOpen}
  link={editing}
  pages={data.pages}
  timeZone={data.timeZone}
  today={data.today}
  oncreated={created}
  onsaved={invalidateAll}
/>
<GuestLinkRevealDialog
  bind:open={revealOpen}
  link={revealed}
  pin={revealedPin}
  rotated={revealedRotated}
/>

<ConfirmDialog
  bind:open={rotateOpen}
  title={m.glinks_rotate_title()}
  description={m.glinks_rotate_description({ label: target?.label ?? "" })}
  confirmLabel={m.glinks_rotate_confirm()}
  pendingLabel={m.glinks_rotate_pending()}
  destructive
  onconfirm={rotate}
/>

<ConfirmDialog
  bind:open={revokeOpen}
  title={m.glinks_revoke_title()}
  description={m.glinks_revoke_description({ label: target?.label ?? "" })}
  confirmLabel={m.glinks_revoke_confirm()}
  pendingLabel={m.glinks_revoke_pending()}
  destructive
  onconfirm={revoke}
/>
