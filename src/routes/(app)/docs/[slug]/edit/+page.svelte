<script lang="ts">
  import DocEditor from "$lib/components/docs/doc-editor.svelte";
  import type { PageProps } from "./$types";

  let { data }: PageProps = $props();
</script>

<DocEditor
  page={data.page}
  assets={data.assets}
  rooms={data.rooms}
  pages={data.pages}
/>
