<script lang="ts">
  import type { Room } from "$lib/api/schemas/rooms";
  import * as Select from "$lib/components/ui/select/index.js";
  import { roomIconFor } from "$lib/assets/room-icons";
  import { cn } from "$lib/utils";

  const NONE = "__none";

  let {
    rooms,
    value = $bindable(null),
    noneLabel,
    id,
    class: className,
    disabled = false,
  }: {
    rooms: Room[];
    /** The selected room id, or null for "no room". */
    value?: string | null;
    /** Label of the option that clears the selection (e.g. "No room" or "All rooms"). */
    noneLabel: string;
    id?: string;
    class?: string;
    disabled?: boolean;
  } = $props();

  const selected = $derived(rooms.find((room) => room.id === value));
  const SelectedIcon = $derived(selected ? roomIconFor(selected.icon) : null);
</script>

<Select.Root
  type="single"
  {disabled}
  bind:value={
    () => value ?? NONE, (next) => (value = next === NONE ? null : next)
  }
>
  <Select.Trigger {id} class={cn("w-full", className)}>
    <span class="flex min-w-0 items-center gap-2">
      {#if SelectedIcon}
        <SelectedIcon class="text-muted-foreground" aria-hidden="true" />
      {/if}
      <span class="truncate">{selected?.name ?? noneLabel}</span>
    </span>
  </Select.Trigger>
  <Select.Content>
    <Select.Item value={NONE} label={noneLabel} class="min-h-10" />
    {#each rooms as room (room.id)}
      {@const Icon = roomIconFor(room.icon)}
      <Select.Item value={room.id} label={room.name} class="min-h-10">
        <span class="flex min-w-0 items-center gap-2">
          <Icon class="text-muted-foreground" aria-hidden="true" />
          <span class="min-w-0 truncate">{room.name}</span>
        </span>
      </Select.Item>
    {/each}
  </Select.Content>
</Select.Root>
