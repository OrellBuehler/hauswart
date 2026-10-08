<script lang="ts">
  import { mode } from "mode-watcher";
  import { THEME_COLORS } from "$lib/pwa/colors";

  // app.html carries one theme-color tag per system palette. The chosen colour mode can differ
  // from the system's, so the tags follow it: the title bar of an installed app and the browser
  // toolbar of a phone then match the page.
  $effect(() => {
    const current = mode.current;
    if (!current) return;
    for (const meta of document.querySelectorAll('meta[name="theme-color"]')) {
      meta.setAttribute("content", THEME_COLORS[current]);
    }
  });
</script>
