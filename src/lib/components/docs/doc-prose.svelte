<script lang="ts">
  import { m } from "$lib/paraglide/messages";
  import { cn } from "$lib/utils";

  let {
    html,
    class: className,
  }: {
    /** Sanitized HTML from the pages API (`renderedHtml`, preview `html`). Never pass anything else. */
    html: string;
    class?: string;
  } = $props();

  const label = (text: string) => JSON.stringify(text);

  /** Files open beside the app instead of replacing it; images open at full size. */
  function onclick(event: MouseEvent) {
    if (event.defaultPrevented || event.button !== 0) return;
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey)
      return;
    const target = event.target;
    if (!(target instanceof Element)) return;
    const image = target.closest("img");
    if (image) {
      event.preventDefault();
      window.open(image.currentSrc || image.src, "_blank", "noopener");
      return;
    }
    const anchor = target.closest("a");
    if (
      anchor &&
      anchor.origin === window.location.origin &&
      anchor.pathname.startsWith("/api/")
    ) {
      event.preventDefault();
      window.open(anchor.href, "_blank", "noopener");
    }
  }
</script>

<!-- The wrapper only delegates clicks; links and images inside carry the semantics. -->
<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
<div
  class={cn("prose-hw", className)}
  style:--hw-secret-label={label(m.docs_secret_label())}
  style:--hw-info-label={label(m.docs_callout_info())}
  style:--hw-warning-label={label(m.docs_callout_warning())}
  {onclick}
>
  <!-- eslint-disable-next-line svelte/no-at-html-tags -- server-sanitized member rendering of a page (allowlist in server/docs/markdown.ts) -->
  {@html html}
</div>
