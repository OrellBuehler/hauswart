<script lang="ts">
  import { invalidateAll } from "$app/navigation";
  import KeyRoundIcon from "@lucide/svelte/icons/key-round";
  import PencilIcon from "@lucide/svelte/icons/pencil";
  import UserPlusIcon from "@lucide/svelte/icons/user-plus";
  import UsersIcon from "@lucide/svelte/icons/users";
  import TriangleAlertIcon from "@lucide/svelte/icons/triangle-alert";
  import { OWNERSHIP_BPS_TOTAL, type AdminUser } from "$lib/api/schemas/users";
  import EmptyState from "$lib/components/app/empty-state.svelte";
  import PageHeader from "$lib/components/app/page-header.svelte";
  import { Badge } from "$lib/components/ui/badge/index.js";
  import { Button } from "$lib/components/ui/button/index.js";
  import * as Card from "$lib/components/ui/card/index.js";
  import { formatDate, formatPercent } from "$lib/format";
  import { m } from "$lib/paraglide/messages";
  import ResetPasswordDialog from "./reset-password-dialog.svelte";
  import UserFormDialog from "./user-form-dialog.svelte";
  import type { PageProps } from "./$types";

  let { data }: PageProps = $props();

  let formOpen = $state(false);
  let formUser = $state<AdminUser | undefined>();
  let resetOpen = $state(false);
  let resetUser = $state<AdminUser | undefined>();

  const totalBps = $derived(
    data.users.reduce((sum, user) => sum + user.ownershipBps, 0),
  );

  function openCreate() {
    formUser = undefined;
    formOpen = true;
  }

  function openEdit(user: AdminUser) {
    formUser = user;
    formOpen = true;
  }

  function openReset(user: AdminUser) {
    resetUser = user;
    resetOpen = true;
  }
</script>

<svelte:head>
  <title>{m.admin_users_title()} · {m.app_name()}</title>
</svelte:head>

<div class="flex flex-col gap-6">
  <PageHeader
    title={m.admin_users_title()}
    description={m.admin_users_description()}
  >
    {#snippet actions()}
      <Button onclick={openCreate}
        ><UserPlusIcon />{m.admin_users_create()}</Button
      >
    {/snippet}
  </PageHeader>

  {#if data.users.length === 0}
    <EmptyState
      icon={UsersIcon}
      title={m.admin_users_empty_title()}
      description={m.admin_users_empty_body()}
    >
      {#snippet actions()}
        <Button onclick={openCreate}
          ><UserPlusIcon />{m.admin_users_create()}</Button
        >
      {/snippet}
    </EmptyState>
  {:else}
    <Card.Root class="py-0">
      <ul class="divide-y">
        {#each data.users as user (user.id)}
          {@const name = user.displayName || user.username}
          <li
            class="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between"
          >
            <div class="flex min-w-0 items-center gap-3">
              <span
                class="bg-muted text-muted-foreground flex size-10 shrink-0 items-center justify-center rounded-full text-sm font-semibold"
                aria-hidden="true">{name.charAt(0).toUpperCase()}</span
              >
              <div class="flex min-w-0 flex-col gap-1">
                <div class="flex flex-wrap items-center gap-x-2 gap-y-1">
                  <span class="min-w-0 truncate font-medium">{name}</span>
                  <Badge
                    variant={user.role === "admin" ? "default" : "secondary"}
                  >
                    {user.role === "admin" ? m.role_admin() : m.role_member()}
                  </Badge>
                  {#if user.id === data.user.id}
                    <Badge variant="outline">{m.admin_users_you()}</Badge>
                  {/if}
                </div>
                <p class="text-muted-foreground text-xs text-pretty">
                  @{user.username} ·
                  {m.admin_users_share({
                    percent: formatPercent(user.ownershipBps),
                  })}
                  · {m.admin_users_created_at({
                    date: formatDate(user.createdAt),
                  })}
                </p>
              </div>
            </div>
            <div class="flex shrink-0 flex-wrap gap-2">
              <Button
                variant="outline"
                size="sm"
                aria-label={`${m.admin_users_edit()}: ${name}`}
                onclick={() => openEdit(user)}
              >
                <PencilIcon />{m.admin_users_edit()}
              </Button>
              <Button
                variant="outline"
                size="sm"
                aria-label={`${m.admin_users_reset_password()}: ${name}`}
                onclick={() => openReset(user)}
              >
                <KeyRoundIcon />{m.admin_users_reset_password()}
              </Button>
            </div>
          </li>
        {/each}
      </ul>
    </Card.Root>
    <p class="text-muted-foreground text-sm">
      {m.admin_users_share_sum({ percent: formatPercent(totalBps) })}
    </p>
    {#if totalBps !== OWNERSHIP_BPS_TOTAL}
      <div class="text-warning -mt-4 flex items-start gap-2 text-sm">
        <TriangleAlertIcon class="mt-0.5 size-4 shrink-0" />
        <p>{m.admin_users_share_sum_warning()}</p>
      </div>
    {/if}
  {/if}
</div>

<UserFormDialog bind:open={formOpen} user={formUser} onsaved={invalidateAll} />
<ResetPasswordDialog
  bind:open={resetOpen}
  user={resetUser}
  onsaved={invalidateAll}
/>
