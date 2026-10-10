<script lang="ts">
  import "../app.css";
  import { ModeWatcher } from "mode-watcher";
  import PwaUpdate from "$lib/components/app/pwa-update.svelte";
  import ThemeColor from "$lib/components/app/theme-color.svelte";
  import { Toaster } from "$lib/components/ui/sonner/index.js";
  let { children } = $props();
</script>

<!-- The theme script lives in app.html so it can carry the CSP nonce. -->
<ModeWatcher disableHeadScriptInjection />
<ThemeColor />
<!-- Clear of the bottom bar and the round action button on phones (--toast-bottom: app.css). The mobile offset only applies up to 600px, the bar goes to 767px. -->
<Toaster
  richColors
  closeButton
  offset={{ bottom: "var(--toast-bottom, 2rem)" }}
  mobileOffset={{ bottom: "var(--toast-bottom, 5rem)" }}
/>
<PwaUpdate />

{@render children()}
