<script lang="ts">
  import { m } from "$lib/paraglide/messages";
  import { cn } from "$lib/utils";

  let { compact = false }: { compact?: boolean } = $props();
</script>

<div class={cn("grid gap-4", compact ? "" : "md:grid-cols-2")}>
  <section class="flex flex-col gap-2">
    <h3 class="text-sm font-semibold">{m.feeds_howto_iphone_title()}</h3>
    <ol
      class="text-muted-foreground flex list-decimal flex-col gap-1 ps-5 text-sm text-pretty"
    >
      <li>{m.feeds_howto_iphone_1()}</li>
      <li>{m.feeds_howto_iphone_2()}</li>
      <li>{m.feeds_howto_iphone_3()}</li>
    </ol>
  </section>
  <section class="flex flex-col gap-2">
    <h3 class="text-sm font-semibold">{m.feeds_howto_google_title()}</h3>
    <ol
      class="text-muted-foreground flex list-decimal flex-col gap-1 ps-5 text-sm text-pretty"
    >
      <li>{m.feeds_howto_google_1()}</li>
      <li>{m.feeds_howto_google_2()}</li>
      <li>{m.feeds_howto_google_3()}</li>
    </ol>
  </section>
</div>
