<script lang="ts" generics="T extends string">
  import { cn } from "$lib/utils";

  let {
    options,
    value = $bindable(),
    label,
    class: className,
    onchange,
  }: {
    options: { value: T; label: string }[];
    value: T;
    label: string;
    class?: string;
    onchange?: (value: T) => void;
  } = $props();

  function select(next: T) {
    value = next;
    onchange?.(next);
  }

  function onkeydown(event: KeyboardEvent, index: number) {
    const step =
      event.key === "ArrowRight" || event.key === "ArrowDown"
        ? 1
        : event.key === "ArrowLeft" || event.key === "ArrowUp"
          ? -1
          : 0;
    if (step === 0) return;
    event.preventDefault();
    const next = options[(index + step + options.length) % options.length];
    select(next.value);
    const buttons = (
      event.currentTarget as HTMLElement
    ).parentElement?.querySelectorAll<HTMLElement>("[role=radio]");
    buttons?.[(index + step + options.length) % options.length]?.focus();
  }
</script>

<div
  role="radiogroup"
  aria-label={label}
  class={cn(
    "bg-muted flex w-full max-w-full flex-wrap rounded-lg p-0.5 sm:inline-flex sm:w-auto",
    className,
  )}
>
  {#each options as option, index (option.value)}
    {@const checked = option.value === value}
    <button
      type="button"
      role="radio"
      aria-checked={checked}
      tabindex={checked ? 0 : -1}
      class={cn(
        "focus-visible:ring-ring/50 min-h-10 rounded-md px-3 py-2 text-center text-sm leading-tight font-medium whitespace-normal transition-colors outline-none focus-visible:ring-[3px] max-sm:flex-1 max-sm:px-2",
        checked
          ? "bg-background shadow-xs"
          : "text-muted-foreground hover:text-foreground",
      )}
      onclick={() => select(option.value)}
      onkeydown={(event) => onkeydown(event, index)}
    >
      {option.label}
    </button>
  {/each}
</div>
