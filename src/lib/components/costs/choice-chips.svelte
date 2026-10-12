<script lang="ts" generics="T extends string">
  import CheckIcon from "@lucide/svelte/icons/check";
  import type { Component } from "svelte";
  import { cn } from "$lib/utils";

  type Option = {
    value: T;
    label: string;
    icon?: Component;
  };

  /**
   * Big round buttons to choose from: one of them (`bind:value`, a radio group) or any number (`mode="multiple"`,
   * `bind:values`, toggle buttons). Phone-sized touch targets; the chosen ones are filled and, when several can be chosen,
   * ticked, so the state never rests on colour alone.
   */
  let {
    options,
    label,
    mode = "single",
    value = $bindable(""),
    values = $bindable([]),
    disabled = false,
    invalid = false,
    describedby,
    class: className,
    onchange,
  }: {
    options: readonly Option[];
    /** The group's accessible name. */
    label: string;
    mode?: "single" | "multiple";
    /** The chosen option of a single choice; empty while none is. */
    value?: T | "";
    /** The chosen options of a multiple choice. */
    values?: T[];
    disabled?: boolean;
    invalid?: boolean;
    describedby?: string | undefined;
    class?: string;
    /** After the person chose: the option (single) or the options now chosen (multiple). */
    onchange?: (chosen: T | T[]) => void;
  } = $props();

  const multiple = $derived(mode === "multiple");

  function isOn(option: Option): boolean {
    return multiple ? values.includes(option.value) : value === option.value;
  }

  function choose(option: Option) {
    if (multiple) {
      values = values.includes(option.value)
        ? values.filter((v) => v !== option.value)
        : [...values, option.value];
      onchange?.(values);
    } else {
      value = option.value;
      onchange?.(option.value);
    }
  }

  function onkeydown(event: KeyboardEvent, index: number) {
    if (multiple) return;
    const step =
      event.key === "ArrowRight" || event.key === "ArrowDown"
        ? 1
        : event.key === "ArrowLeft" || event.key === "ArrowUp"
          ? -1
          : 0;
    if (step === 0) return;
    event.preventDefault();
    const target = (index + step + options.length) % options.length;
    choose(options[target]!);
    const buttons = (
      event.currentTarget as HTMLElement
    ).parentElement?.querySelectorAll<HTMLElement>("[role=radio]");
    buttons?.[target]?.focus();
  }

  // One tab stop for a radio group: the chosen chip, else the first.
  const tabbable = $derived(
    Math.max(
      0,
      options.findIndex((option) => value === option.value),
    ),
  );
</script>

<div
  role={multiple ? "group" : "radiogroup"}
  aria-label={label}
  aria-invalid={invalid || undefined}
  aria-describedby={describedby}
  class={cn("flex flex-wrap gap-2", className)}
>
  {#each options as option, index (option.value)}
    {@const on = isOn(option)}
    <button
      type="button"
      role={multiple ? undefined : "radio"}
      aria-checked={multiple ? undefined : on}
      aria-pressed={multiple ? on : undefined}
      tabindex={multiple || index === tabbable ? 0 : -1}
      {disabled}
      class={cn(
        "focus-visible:ring-ring/50 inline-flex min-h-11 max-w-full min-w-0 items-center gap-1.5 rounded-full border px-3.5 text-sm font-medium transition-colors outline-none focus-visible:ring-[3px] disabled:pointer-events-none disabled:opacity-50 pointer-coarse:min-h-12",
        on
          ? "border-brand bg-brand text-brand-foreground"
          : "bg-card hover:bg-accent",
        invalid && !on && "border-destructive/60",
      )}
      onclick={() => choose(option)}
      onkeydown={(event) => onkeydown(event, index)}
    >
      {#if multiple && on}
        <CheckIcon class="size-4 shrink-0" aria-hidden="true" />
      {:else if option.icon}
        <option.icon class="size-4 shrink-0" aria-hidden="true" />
      {/if}
      <span class="truncate">{option.label}</span>
    </button>
  {/each}
</div>
