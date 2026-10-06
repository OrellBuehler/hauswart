<script lang="ts">
  import LoaderCircleIcon from "@lucide/svelte/icons/loader-circle";
  import { toast } from "svelte-sonner";
  import { api } from "$lib/api/browser";
  import { endpoints } from "$lib/api/registry";
  import { ROOM_NAME_MAX, type Room } from "$lib/api/schemas/rooms";
  import { roomIconNames, roomIcons } from "$lib/assets/room-icons";
  import FormAlert from "$lib/components/app/form-alert.svelte";
  import { Button } from "$lib/components/ui/button/index.js";
  import * as Dialog from "$lib/components/ui/dialog/index.js";
  import { Input } from "$lib/components/ui/input/index.js";
  import { Label } from "$lib/components/ui/label/index.js";
  import { Textarea } from "$lib/components/ui/textarea/index.js";
  import { apiErrorMessage } from "$lib/error-message";
  import { m } from "$lib/paraglide/messages";
  import { cn } from "$lib/utils";

  let {
    open = $bindable(false),
    room,
    nextSortOrder = 0,
    onsaved,
  }: {
    open?: boolean;
    /** The room to edit; undefined creates a new one. */
    room: Room | undefined;
    /** Sort order given to a new room so it lands at the end. */
    nextSortOrder?: number;
    onsaved: (room: Room) => void | Promise<void>;
  } = $props();

  let name = $state("");
  let icon = $state<string | null>(null);
  let notes = $state("");
  let haAreaId = $state("");
  let pending = $state(false);
  let error = $state<string | undefined>();

  const editing = $derived(room !== undefined);

  $effect(() => {
    if (!open) return;
    name = room?.name ?? "";
    icon = room?.icon ?? null;
    notes = room?.notes ?? "";
    haAreaId = room?.haAreaId ?? "";
    error = undefined;
  });

  async function submit(event: SubmitEvent) {
    event.preventDefault();
    if (pending) return;
    pending = true;
    error = undefined;
    try {
      const fields = { name, icon, notes, haAreaId };
      const saved = room
        ? await api.call(endpoints.roomsUpdate, {
            params: { id: room.id },
            body: fields,
          })
        : await api.call(endpoints.roomsCreate, {
            body: { ...fields, sortOrder: nextSortOrder },
          });
      toast.success(
        editing
          ? m.rooms_saved_toast({ name: saved.name })
          : m.rooms_created_toast({ name: saved.name }),
      );
      open = false;
      await onsaved(saved);
    } catch (err) {
      error = apiErrorMessage(err, { conflict: m.rooms_error_name_taken() });
    } finally {
      pending = false;
    }
  }
</script>

<Dialog.Root bind:open={() => open, (value) => (open = pending ? true : value)}>
  <Dialog.Content class="max-h-[calc(100svh-2rem)] overflow-y-auto">
    <Dialog.Header>
      <Dialog.Title>
        {editing ? m.rooms_edit_title() : m.rooms_create_title()}
      </Dialog.Title>
      <Dialog.Description>
        {editing ? m.rooms_edit_description() : m.rooms_create_description()}
      </Dialog.Description>
    </Dialog.Header>
    <form class="flex flex-col gap-5" onsubmit={submit}>
      <div class="flex flex-col gap-2">
        <Label for="room-name">{m.rooms_name()}</Label>
        <Input
          id="room-name"
          autocomplete="off"
          required
          maxlength={ROOM_NAME_MAX}
          bind:value={name}
        />
      </div>
      <fieldset class="flex flex-col gap-2">
        <legend class="mb-1 text-sm leading-none font-medium">
          {m.rooms_icon()}
        </legend>
        <div
          role="radiogroup"
          aria-label={m.rooms_icon()}
          class="grid grid-cols-6 gap-1.5 sm:grid-cols-8"
        >
          {#each roomIconNames as iconName (iconName)}
            {@const entry = roomIcons[iconName]}
            {@const selected = icon === iconName}
            <button
              type="button"
              role="radio"
              aria-checked={selected}
              aria-label={entry.label()}
              title={entry.label()}
              class={cn(
                "text-muted-foreground hover:bg-accent focus-visible:ring-ring/50 flex aspect-square items-center justify-center rounded-md border transition-colors outline-none focus-visible:ring-[3px]",
                selected &&
                  "border-brand bg-brand/10 text-brand hover:bg-brand/15",
              )}
              onclick={() => (icon = selected ? null : iconName)}
            >
              <entry.icon class="size-5" aria-hidden="true" />
            </button>
          {/each}
        </div>
      </fieldset>
      <div class="flex flex-col gap-2">
        <Label for="room-notes">
          {m.rooms_notes()}
          <span class="text-muted-foreground font-normal">
            {m.common_optional()}
          </span>
        </Label>
        <Textarea
          id="room-notes"
          rows={3}
          maxlength={10000}
          placeholder={m.rooms_notes_placeholder()}
          bind:value={notes}
        />
      </div>
      <details class="group rounded-lg border px-3 py-2">
        <summary
          class="text-muted-foreground cursor-pointer text-sm font-medium select-none"
        >
          {m.rooms_advanced()}
        </summary>
        <div class="mt-3 flex flex-col gap-2 pb-1">
          <Label for="room-ha-area">{m.rooms_ha_area()}</Label>
          <Input
            id="room-ha-area"
            autocomplete="off"
            autocapitalize="none"
            spellcheck={false}
            maxlength={200}
            placeholder="wohnzimmer"
            bind:value={haAreaId}
          />
          <p class="text-muted-foreground text-xs">{m.rooms_ha_area_hint()}</p>
        </div>
      </details>
      <FormAlert message={error} />
      <Dialog.Footer>
        <Button
          type="button"
          variant="outline"
          disabled={pending}
          onclick={() => (open = false)}
        >
          {m.common_cancel()}
        </Button>
        <Button type="submit" disabled={pending}>
          {#if pending}
            <LoaderCircleIcon class="animate-spin" />{m.common_saving()}
          {:else if editing}
            {m.common_save()}
          {:else}
            {m.common_create()}
          {/if}
        </Button>
      </Dialog.Footer>
    </form>
  </Dialog.Content>
</Dialog.Root>
