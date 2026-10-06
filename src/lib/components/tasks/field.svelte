<script lang="ts">
  import type { Snippet } from "svelte";
  import { Label } from "$lib/components/ui/label/index.js";
  import { m } from "$lib/paraglide/messages";
  import { cn } from "$lib/utils";

  let {
    id,
    label,
    hint,
    error,
    optional = false,
    class: className,
    children,
  }: {
    id: string;
    label: string;
    hint?: string | undefined;
    error?: string | undefined;
    optional?: boolean;
    class?: string;
    /** `describedby` goes on the control's `aria-describedby`; `invalid` on `aria-invalid`. */
    children: Snippet<[{ describedby: string | undefined; invalid: boolean }]>;
  } = $props();

  const describedby = $derived(
    [hint ? `${id}-hint` : null, error ? `${id}-error` : null]
      .filter(Boolean)
      .join(" ") || undefined,
  );
</script>

<div class={cn("flex min-w-0 flex-col gap-2", className)}>
  <Label for={id}>
    {label}
    {#if optional}
      <span class="text-muted-foreground font-normal"
        >({m.common_optional()})</span
      >
    {/if}
  </Label>
  {@render children({ describedby, invalid: Boolean(error) })}
  {#if hint}
    <p id={`${id}-hint`} class="text-muted-foreground text-xs text-pretty">
      {hint}
    </p>
  {/if}
  {#if error}
    <p id={`${id}-error`} class="text-destructive text-xs text-pretty">
      {error}
    </p>
  {/if}
</div>
