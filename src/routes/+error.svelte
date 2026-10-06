<script lang="ts">
  import { page } from "$app/state";
  import ErrorState from "$lib/components/app/error-state.svelte";
</script>

<main class="mx-auto max-w-xl p-4">
  <ErrorState status={page.status} message={page.error?.message ?? ""} />
</main>
