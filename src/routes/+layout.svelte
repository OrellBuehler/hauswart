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
<Toaster richColors closeButton />
<PwaUpdate />

{@render children()}
