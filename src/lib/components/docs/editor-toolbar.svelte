<script lang="ts" module>
  export type ToolbarAction =
    | "bold"
    | "italic"
    | "h2"
    | "h3"
    | "bullet"
    | "numbered"
    | "task"
    | "link"
    | "info"
    | "warning"
    | "secret"
    | "wiki"
    | "attachment";
</script>

<script lang="ts">
  import BoldIcon from "@lucide/svelte/icons/bold";
  import BracketsIcon from "@lucide/svelte/icons/brackets";
  import ChevronDownIcon from "@lucide/svelte/icons/chevron-down";
  import HeadingIcon from "@lucide/svelte/icons/heading";
  import InfoIcon from "@lucide/svelte/icons/info";
  import ItalicIcon from "@lucide/svelte/icons/italic";
  import LinkIcon from "@lucide/svelte/icons/link";
  import ListIcon from "@lucide/svelte/icons/list";
  import ListOrderedIcon from "@lucide/svelte/icons/list-ordered";
  import ListTodoIcon from "@lucide/svelte/icons/list-todo";
  import LockIcon from "@lucide/svelte/icons/lock";
  import MessageSquareWarningIcon from "@lucide/svelte/icons/message-square-warning";
  import PaperclipIcon from "@lucide/svelte/icons/paperclip";
  import TriangleAlertIcon from "@lucide/svelte/icons/triangle-alert";
  import { Button } from "$lib/components/ui/button/index.js";
  import * as DropdownMenu from "$lib/components/ui/dropdown-menu/index.js";
  import { m } from "$lib/paraglide/messages";

  let {
    onaction,
    disabled = false,
  }: {
    onaction: (action: ToolbarAction) => void;
    disabled?: boolean;
  } = $props();

  const mod = $derived(
    typeof navigator !== "undefined" &&
      /mac|iphone|ipad/i.test(navigator.platform)
      ? "⌘"
      : "Ctrl+",
  );
</script>

{#snippet tool(action: ToolbarAction, label: string, shortcut?: string)}
  <Button
    type="button"
    variant="ghost"
    size="icon"
    class="size-10 shrink-0 sm:size-8"
    {disabled}
    title={shortcut ? `${label} (${shortcut})` : label}
    aria-label={label}
    onmousedown={(event) => event.preventDefault()}
    onclick={() => onaction(action)}
  >
    {#if action === "bold"}<BoldIcon />
    {:else if action === "italic"}<ItalicIcon />
    {:else if action === "bullet"}<ListIcon />
    {:else if action === "numbered"}<ListOrderedIcon />
    {:else if action === "task"}<ListTodoIcon />
    {:else if action === "link"}<LinkIcon />
    {:else if action === "secret"}<LockIcon />
    {:else if action === "wiki"}<BracketsIcon />
    {:else if action === "attachment"}<PaperclipIcon />
    {/if}
  </Button>
{/snippet}

<div
  role="toolbar"
  aria-label={m.editor_toolbar()}
  aria-controls="doc-editor-text"
  class="flex items-center gap-0.5 overflow-x-auto border-b p-1.5"
>
  {@render tool("bold", m.editor_bold(), `${mod}B`)}
  {@render tool("italic", m.editor_italic(), `${mod}I`)}
  <DropdownMenu.Root>
    <DropdownMenu.Trigger>
      {#snippet child({ props })}
        <Button
          {...props}
          type="button"
          variant="ghost"
          class="h-10 shrink-0 gap-0.5 px-1.5 sm:h-8"
          {disabled}
          title={m.editor_heading()}
          aria-label={m.editor_heading()}
          onmousedown={(event) => event.preventDefault()}
        >
          <HeadingIcon /><ChevronDownIcon class="size-3 opacity-60" />
        </Button>
      {/snippet}
    </DropdownMenu.Trigger>
    <DropdownMenu.Content
      align="start"
      onCloseAutoFocus={(event) => event.preventDefault()}
    >
      <DropdownMenu.Item class="min-h-10" onSelect={() => onaction("h2")}>
        <span class="text-base font-semibold">{m.editor_heading_2()}</span>
      </DropdownMenu.Item>
      <DropdownMenu.Item class="min-h-10" onSelect={() => onaction("h3")}>
        <span class="text-sm font-semibold">{m.editor_heading_3()}</span>
      </DropdownMenu.Item>
    </DropdownMenu.Content>
  </DropdownMenu.Root>
  <span class="bg-border mx-1 h-5 w-px shrink-0" aria-hidden="true"></span>
  {@render tool("bullet", m.editor_bullet_list())}
  {@render tool("numbered", m.editor_numbered_list())}
  {@render tool("task", m.editor_task_list())}
  <span class="bg-border mx-1 h-5 w-px shrink-0" aria-hidden="true"></span>
  {@render tool("link", m.editor_link())}
  {@render tool("wiki", m.editor_wiki_link())}
  {@render tool("attachment", m.editor_insert_attachment())}
  <span class="bg-border mx-1 h-5 w-px shrink-0" aria-hidden="true"></span>
  <DropdownMenu.Root>
    <DropdownMenu.Trigger>
      {#snippet child({ props })}
        <Button
          {...props}
          type="button"
          variant="ghost"
          class="h-10 shrink-0 gap-0.5 px-1.5 sm:h-8"
          {disabled}
          title={m.editor_callout()}
          aria-label={m.editor_callout()}
          onmousedown={(event) => event.preventDefault()}
        >
          <MessageSquareWarningIcon /><ChevronDownIcon
            class="size-3 opacity-60"
          />
        </Button>
      {/snippet}
    </DropdownMenu.Trigger>
    <DropdownMenu.Content
      align="start"
      onCloseAutoFocus={(event) => event.preventDefault()}
    >
      <DropdownMenu.Item class="min-h-10" onSelect={() => onaction("info")}>
        <InfoIcon />{m.editor_callout_info()}
      </DropdownMenu.Item>
      <DropdownMenu.Item class="min-h-10" onSelect={() => onaction("warning")}>
        <TriangleAlertIcon />{m.editor_callout_warning()}
      </DropdownMenu.Item>
    </DropdownMenu.Content>
  </DropdownMenu.Root>
  {@render tool("secret", m.editor_secret())}
</div>
