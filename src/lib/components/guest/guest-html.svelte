<script lang="ts">
  import type { UserLocale } from "$lib/api/enums";
  import { m } from "$lib/paraglide/messages";
  import { cn } from "$lib/utils";

  let {
    html,
    locale,
    class: className,
  }: { html: string; locale: UserLocale; class?: string } = $props();

  const label = (text: string) => JSON.stringify(text);
</script>

<div
  class={cn("prose-hw", className)}
  style:--hw-secret-label={label(m.docs_secret_label({}, { locale }))}
  style:--hw-info-label={label(m.docs_callout_info({}, { locale }))}
  style:--hw-warning-label={label(m.docs_callout_warning({}, { locale }))}
>
  <!-- The HTML comes from the markdown renderer's sanitizer (tag and attribute allowlist). -->
  <!-- eslint-disable-next-line svelte/no-at-html-tags -->
  {@html html}
</div>
