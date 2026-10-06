<script lang="ts">
  import { cn } from "$lib/utils";

  type Chip = { value: number; label: string; aria?: string };

  let {
    options,
    selected = $bindable([]),
    single = false,
    label,
    class: className,
    onchange,
  }: {
    options: Chip[];
    selected?: number[];
    /** Exactly one chip at a time. */
    single?: boolean;
    label: string;
    class?: string;
    onchange?: () => void;
  } = $props();

  function toggle(value: number) {
    if (single) {
      selected = [value];
    } else if (selected.includes(value)) {
      selected = selected.filter((v) => v !== value);
    } else {
      selected = [...selected, value].sort((a, b) => a - b);
    }
    onchange?.();
  }
</script>

<div
  role="group"
  aria-label={label}
  class={cn("flex flex-wrap gap-1.5", className)}
>
  {#each options as option (option.value)}
    {@const on = selected.includes(option.value)}
    <button
      type="button"
      class={cn(
        "focus-visible:ring-ring/50 h-10 min-w-10 rounded-md border px-2.5 text-sm font-medium transition-colors outline-none focus-visible:ring-[3px]",
        on
          ? "bg-brand text-brand-foreground border-transparent"
          : "bg-background hover:bg-accent dark:bg-input/30",
      )}
      aria-pressed={on}
      aria-label={option.aria}
      onclick={() => toggle(option.value)}
    >
      {option.label}
    </button>
  {/each}
</div>
