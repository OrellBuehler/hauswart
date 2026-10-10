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
    /**
     * Optional pointer to the place that explains or manages the setting, shown after the hint. It
     * opens in a tab of its own, so the form keeps what was typed; `sameTab` is for a form that asks
     * before it is left.
     */
    link?: { href: "/settings/guest-links"; label: string; sameTab?: boolean };
    disabled?: boolean;
    class?: string;
    onchange?: (checked: boolean) => void;
  } = $props();
</script>

<div
  class={cn(
    "relative flex items-start gap-3 pointer-coarse:min-h-11 pointer-coarse:py-1.5",
    !hint && "pointer-coarse:items-center",
    className,
  )}
>
  <Switch
    {id}
    class={cn("mt-0.5", !hint && "pointer-coarse:mt-0")}
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
  <div class="flex min-w-0 flex-col gap-1">
    <Label
      for={id}
      class="leading-snug font-normal pointer-coarse:after:absolute pointer-coarse:after:inset-0"
    >
      {label}
    </Label>
    {#if hint}
      <p id={`${id}-hint`} class="text-muted-foreground text-xs text-pretty">
        {hint}
        {#if link}
          <a
            href={resolve(link.href)}
            target={link.sameTab ? undefined : "_blank"}
            rel={link.sameTab ? undefined : "noopener"}
            class="text-brand relative z-10 font-medium underline underline-offset-4"
          >
            {link.label}
          </a>
        {/if}
      </p>
    {/if}
  </div>
</div>
