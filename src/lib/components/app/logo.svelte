<script lang="ts">
  import { cn } from "#lib/utils.ts";
  import { m } from "#lib/paraglide/messages.js";

  let {
    class: className,
    showName = true,
  }: { class?: string; showName?: boolean } = $props();
</script>

<span class={cn("inline-flex items-center gap-2.5", className)}>
  <span
    class="bg-brand text-brand-foreground shadow-card flex size-8 shrink-0 items-center justify-center rounded-lg"
    aria-hidden="true"
  >
    <svg viewBox="0 0 256 256" class="size-5" fill="currentColor">
      <path
        d="M40 20H88V104L128 64L216 152V236H120V188L168 168L128 128L88 168V236H40Z"
      />
    </svg>
  </span>
  {#if showName}
    <span
      class="text-lg font-semibold tracking-tight group-data-[collapsible=icon]:hidden"
    >
      {m.app_name()}
    </span>
  {/if}
</span>
