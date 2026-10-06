<script lang="ts">
  import ArrowDownIcon from "@lucide/svelte/icons/arrow-down";
  import ArrowUpIcon from "@lucide/svelte/icons/arrow-up";
  import CalendarPlusIcon from "@lucide/svelte/icons/calendar-plus";
  import EllipsisVerticalIcon from "@lucide/svelte/icons/ellipsis-vertical";
  import EyeIcon from "@lucide/svelte/icons/eye";
  import PencilIcon from "@lucide/svelte/icons/pencil";
  import PinIcon from "@lucide/svelte/icons/pin";
  import Trash2Icon from "@lucide/svelte/icons/trash-2";
  import type { Hint } from "$lib/api/schemas/hints";
  import { planTaskHref } from "$lib/assets/links";
  import { Badge } from "$lib/components/ui/badge/index.js";
  import { Button } from "$lib/components/ui/button/index.js";
  import * as DropdownMenu from "$lib/components/ui/dropdown-menu/index.js";
  import { hintKindIcons, hintKindLabels, hintTones } from "$lib/hints/labels";
  import { taskHref } from "$lib/links";
  import { m } from "$lib/paraglide/messages";
  import { cn } from "$lib/utils";
  import HintReactionNote from "./hint-reaction-note.svelte";

  let {
    hint,
    canMoveUp,
    canMoveDown,
    busy = false,
    onedit,
    ontogglepin,
    ontoggleguest,
    onmove,
    ondelete,
  }: {
    hint: Hint;
    canMoveUp: boolean;
    canMoveDown: boolean;
    busy?: boolean;
    onedit: () => void;
    ontogglepin: () => void;
    ontoggleguest: () => void;
    onmove: (direction: -1 | 1) => void;
    ondelete: () => void;
  } = $props();

  const Icon = $derived(hintKindIcons[hint.kind]);
  const tone = $derived(hintTones[hint.kind]);
</script>

<li
  class={cn(
    "flex flex-col gap-3 rounded-xl border p-4",
    hint.pinned ? tone.pinned : tone.card,
  )}
>
  <div class="flex items-center gap-2.5">
    <span
      class={cn(
        "flex size-8 shrink-0 items-center justify-center rounded-lg",
        tone.tile,
      )}
      aria-hidden="true"
    >
      <Icon class="size-4" />
    </span>
    <span class="text-muted-foreground min-w-0 flex-1 text-xs font-medium">
      {hintKindLabels[hint.kind]()}
    </span>
    <div class="-me-2 flex shrink-0 items-center">
      <Button
        variant="ghost"
        size="icon-lg"
        disabled={busy}
        aria-pressed={hint.pinned}
        aria-label={hint.pinned
          ? m.hint_unpin_aria({ title: hint.title })
          : m.hint_pin_aria({ title: hint.title })}
        onclick={ontogglepin}
      >
        <PinIcon
          class={hint.pinned ? "fill-current" : "text-muted-foreground"}
        />
      </Button>
      <DropdownMenu.Root>
        <DropdownMenu.Trigger>
          {#snippet child({ props })}
            <Button
              {...props}
              variant="ghost"
              size="icon-lg"
              disabled={busy}
              aria-label={m.hint_actions_aria({ title: hint.title })}
            >
              <EllipsisVerticalIcon />
            </Button>
          {/snippet}
        </DropdownMenu.Trigger>
        <DropdownMenu.Content align="end" class="min-w-52">
          <DropdownMenu.Item class="min-h-10" onSelect={onedit}>
            <PencilIcon />{m.common_edit()}
          </DropdownMenu.Item>
          <DropdownMenu.CheckboxItem
            class="min-h-10"
            checked={hint.guestVisible}
            onCheckedChange={ontoggleguest}
          >
            {m.hint_guest_visible()}
          </DropdownMenu.CheckboxItem>
          <DropdownMenu.Separator />
          <DropdownMenu.Item
            class="min-h-10"
            disabled={!canMoveUp}
            onSelect={() => onmove(-1)}
          >
            <ArrowUpIcon />{m.hint_move_up()}
          </DropdownMenu.Item>
          <DropdownMenu.Item
            class="min-h-10"
            disabled={!canMoveDown}
            onSelect={() => onmove(1)}
          >
            <ArrowDownIcon />{m.hint_move_down()}
          </DropdownMenu.Item>
          <DropdownMenu.Separator />
          <DropdownMenu.Item
            variant="destructive"
            class="min-h-10"
            onSelect={ondelete}
          >
            <Trash2Icon />{m.common_delete()}
          </DropdownMenu.Item>
        </DropdownMenu.Content>
      </DropdownMenu.Root>
    </div>
  </div>

  <div class="min-w-0">
    <h3 class="text-sm leading-snug font-semibold break-words">
      {hint.title}
    </h3>
    {#if hint.bodyMd.trim()}
      <p
        class="text-foreground/90 mt-1 text-sm leading-relaxed break-words whitespace-pre-line"
      >
        {hint.bodyMd}
      </p>
    {/if}
  </div>

  {#if hint.guestVisible || hint.reaction}
    <div class="flex flex-col gap-1.5">
      {#if hint.guestVisible}
        <Badge variant="secondary" class="w-fit">
          <EyeIcon aria-hidden="true" />{m.hint_guest_badge()}
        </Badge>
      {/if}
      {#if hint.reaction}
        <HintReactionNote reaction={hint.reaction} />
      {/if}
    </div>
  {/if}

  <div>
    {#if hint.taskId && hint.taskTitle}
      <Button
        href={taskHref(hint.taskId)}
        variant="outline"
        size="sm"
        class="max-w-full"
      >
        <CalendarPlusIcon />
        <span class="truncate"
          >{m.hint_task_linked({ title: hint.taskTitle })}</span
        >
      </Button>
    {:else}
      <Button
        href={planTaskHref(hint.assetId, hint.title, hint.bodyMd.trim())}
        variant="outline"
        size="sm"
      >
        <CalendarPlusIcon />{m.hint_plan_task()}
      </Button>
    {/if}
  </div>
</li>
