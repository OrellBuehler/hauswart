<script lang="ts">
  import { resolve } from "$app/paths";
  import { Label } from "$lib/components/ui/label/index.js";
  import { Switch } from "$lib/components/ui/switch/index.js";
  import { cn } from "$lib/utils";

  let {
    id,
    checked = $bindable(false),
    label,
    hint,
    link,
    disabled = false,
    class: className,
    onchange,
  }: {
    id: string;
    checked?: boolean;
    label: string;
    hint?: string;
    /** Optional pointer to the place that explains or manages the setting, shown after the hint. */
    link?: { href: "/settings/guest-links"; label: string };
    disabled?: boolean;
    class?: string;
    onchange?: (checked: boolean) => void;
  } = $props();
</script>

<div class={cn("flex items-start gap-3", className)}>
  <Switch
    {id}
    class="mt-0.5"
    {disabled}
    aria-describedby={hint ? `${id}-hint` : undefined}
    bind:checked={
      () => checked,
      (value) => {
        checked = value;
        onchange?.(value);
      }
    }
  />
  <div class="flex flex-col gap-1">
    <Label for={id} class="leading-snug font-normal">{label}</Label>
    {#if hint}
      <p id={`${id}-hint`} class="text-muted-foreground text-xs text-pretty">
        {hint}
        {#if link}
          <a
            href={resolve(link.href)}
            target="_blank"
            rel="noopener"
            class="text-brand font-medium underline underline-offset-4"
          >
            {link.label}
          </a>
        {/if}
      </p>
    {/if}
  </div>
</div>
