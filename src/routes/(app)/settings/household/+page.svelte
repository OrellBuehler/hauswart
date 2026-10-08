<script lang="ts">
  import { invalidateAll } from "$app/navigation";
  import LoaderCircleIcon from "@lucide/svelte/icons/loader-circle";
  import { toast } from "svelte-sonner";
  import { api } from "$lib/api/browser";
  import { endpoints } from "$lib/api/registry";
  import FormAlert from "$lib/components/app/form-alert.svelte";
  import HostChipsInput from "$lib/components/app/host-chips-input.svelte";
  import { Button } from "$lib/components/ui/button/index.js";
  import * as Card from "$lib/components/ui/card/index.js";
  import { Input } from "$lib/components/ui/input/index.js";
  import { Label } from "$lib/components/ui/label/index.js";
  import { apiErrorMessage } from "$lib/error-message";
  import { m } from "$lib/paraglide/messages";
  import type { PageProps } from "./$types";

  let { data }: PageProps = $props();

  const canEdit = $derived(data.user.role === "admin");

  /* The form is seeded once; saving reloads the page data and the baseline below. */
  /* svelte-ignore state_referenced_locally */
  let name = $state(data.household.name);
  /* svelte-ignore state_referenced_locally */
  let handoverDate = $state(data.household.handoverDate ?? "");
  /* svelte-ignore state_referenced_locally */
  let dueSoonDays = $state(data.household.settings.dueSoonDays);
  /* svelte-ignore state_referenced_locally */
  let digestTime = $state(data.household.settings.digestTime);
  /* svelte-ignore state_referenced_locally */
  let hostAllowlist = $state([
    ...(data.household.settings.integrationHostAllowlist ?? []),
  ]);
  let pending = $state(false);
  let error = $state<string | undefined>();

  const dirty = $derived(
    name.trim() !== data.household.name ||
      handoverDate !== (data.household.handoverDate ?? "") ||
      dueSoonDays !== data.household.settings.dueSoonDays ||
      digestTime !== data.household.settings.digestTime ||
      (canEdit &&
        hostAllowlist.join("\n") !==
          (data.household.settings.integrationHostAllowlist ?? []).join("\n")),
  );

  async function submit(event: SubmitEvent) {
    event.preventDefault();
    if (!canEdit || !dirty || pending) return;
    if (!Number.isInteger(dueSoonDays) || dueSoonDays < 0 || dueSoonDays > 60) {
      error = m.household_due_soon_invalid();
      return;
    }
    pending = true;
    error = undefined;
    try {
      const saved = await api.call(endpoints.householdUpdate, {
        body: {
          name,
          handoverDate: handoverDate === "" ? null : handoverDate,
          settings: {
            dueSoonDays,
            digestTime,
            integrationHostAllowlist: hostAllowlist,
          },
        },
      });
      name = saved.name;
      handoverDate = saved.handoverDate ?? "";
      dueSoonDays = saved.settings.dueSoonDays;
      digestTime = saved.settings.digestTime;
      hostAllowlist = [...(saved.settings.integrationHostAllowlist ?? [])];
      await invalidateAll();
      toast.success(m.household_saved());
    } catch (err) {
      error = apiErrorMessage(err);
    } finally {
      pending = false;
    }
  }
</script>

<svelte:head>
  <title>{m.household_title()} · {m.settings_title()} · {m.app_name()}</title>
</svelte:head>

<Card.Root>
  <Card.Header>
    <Card.Title>{m.household_title()}</Card.Title>
    <Card.Description>
      {canEdit ? m.household_description() : m.household_description_readonly()}
    </Card.Description>
  </Card.Header>
  <Card.Content>
    <form class="flex flex-col gap-5" onsubmit={submit}>
      <FormAlert message={error} />
      <div class="flex flex-col gap-2">
        <Label for="household-name">{m.household_name()}</Label>
        <Input
          id="household-name"
          autocomplete="off"
          required
          maxlength={100}
          disabled={!canEdit}
          bind:value={name}
        />
      </div>
      <div class="flex flex-col gap-2">
        <Label for="household-handover">{m.household_handover()}</Label>
        <Input
          id="household-handover"
          type="date"
          disabled={!canEdit}
          bind:value={handoverDate}
        />
        <p class="text-muted-foreground text-xs">
          {m.household_handover_hint()}
        </p>
      </div>
      <div class="grid gap-5 sm:grid-cols-2">
        <div class="flex flex-col gap-2">
          <Label for="household-due-soon">{m.household_due_soon()}</Label>
          <Input
            id="household-due-soon"
            type="number"
            inputmode="numeric"
            min={0}
            max={60}
            required
            disabled={!canEdit}
            bind:value={dueSoonDays}
          />
          <p class="text-muted-foreground text-xs">
            {m.household_due_soon_hint()}
          </p>
        </div>
        <div class="flex flex-col gap-2">
          <Label for="household-digest">{m.household_digest()}</Label>
          <Input
            id="household-digest"
            type="time"
            required
            disabled={!canEdit}
            bind:value={digestTime}
          />
          <p class="text-muted-foreground text-xs">
            {m.household_digest_hint()}
          </p>
        </div>
      </div>
      {#if canEdit}
        <div class="flex flex-col gap-2">
          <Label for="household-host-allowlist">
            {m.household_host_allowlist()}
          </Label>
          <HostChipsInput
            id="household-host-allowlist"
            bind:value={hostAllowlist}
          />
          <p class="text-muted-foreground text-xs">
            {m.household_host_allowlist_hint()}
          </p>
        </div>
      {/if}
      <dl
        class="grid grid-cols-[auto_1fr] items-center gap-x-6 gap-y-2 border-t pt-4 text-sm"
      >
        <dt class="text-muted-foreground">{m.household_timezone()}</dt>
        <dd class="font-medium">{data.household.timezone}</dd>
        <dt class="text-muted-foreground">{m.household_currency()}</dt>
        <dd class="font-medium">{data.household.currency}</dd>
      </dl>
      <p class="text-muted-foreground -mt-2 text-xs">
        {m.household_timezone_hint()}
      </p>
      {#if canEdit}
        <div>
          <Button type="submit" disabled={!dirty || pending}>
            {#if pending}
              <LoaderCircleIcon class="animate-spin" />{m.common_saving()}
            {:else}
              {m.common_save()}
            {/if}
          </Button>
        </div>
      {/if}
    </form>
  </Card.Content>
</Card.Root>
