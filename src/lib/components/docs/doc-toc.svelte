<script lang="ts">
  import ChevronDownIcon from "@lucide/svelte/icons/chevron-down";
  import ListTreeIcon from "@lucide/svelte/icons/list-tree";
  import type { Heading } from "$lib/api/schemas/docs";
  import { m } from "$lib/paraglide/messages";
  import { cn } from "$lib/utils";

  let {
    headings,
    activeId,
    class: className,
  }: {
    headings: Heading[];
    activeId?: string | null;
    class?: string;
  } = $props();

  const id = $props.id();
  let open = $state(false);

  const base = $derived(Math.min(...headings.map((h) => h.level)));

  function jump(event: MouseEvent, id: string) {
    const target = document.getElementById(id);
    if (!target) return;
    event.preventDefault();
    const reduce = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;
    target.scrollIntoView({
      behavior: reduce ? "auto" : "smooth",
      block: "start",
    });
    open = false;
  }
</script>

<nav aria-label={m.docs_toc()} class={cn("text-sm", className)}>
  <button
    type="button"
    class="focus-visible:ring-ring/50 flex min-h-11 w-full items-center gap-2 rounded-lg border px-3 text-start font-medium outline-none focus-visible:ring-[3px] lg:hidden"
    aria-expanded={open}
    aria-controls={`${id}-list`}
    onclick={() => (open = !open)}
  >
    <ListTreeIcon
      class="text-muted-foreground size-4 shrink-0"
      aria-hidden="true"
    />
    <span class="flex-1">{m.docs_toc()}</span>
    <ChevronDownIcon
      class={cn(
        "text-muted-foreground size-4 shrink-0 transition-transform",
        open && "rotate-180",
      )}
      aria-hidden="true"
    />
  </button>
  <p class="mb-2 hidden items-center gap-2 font-medium lg:flex">
    <ListTreeIcon
      class="text-muted-foreground size-4 shrink-0"
      aria-hidden="true"
    />
    {m.docs_toc()}
  </p>
  <ol
    id={`${id}-list`}
    class={cn(
      "mt-1 flex flex-col border-s lg:mt-0 lg:max-h-[calc(100svh-9rem)] lg:overflow-y-auto",
      !open && "max-lg:hidden",
    )}
  >
    {#each headings as heading (heading.id)}
      {@const active = activeId === heading.id}
      <li>
        <a
          href={`#${heading.id}`}
          class={cn(
            "focus-visible:ring-ring/50 -ms-px block min-h-9 border-s-2 py-1.5 pe-2 leading-snug break-words outline-none focus-visible:ring-[3px] focus-visible:ring-inset lg:min-h-0 lg:py-1",
            active
              ? "border-brand text-foreground font-medium"
              : "text-muted-foreground hover:text-foreground border-transparent",
          )}
          style:padding-inline-start={`${0.75 + (heading.level - base) * 0.75}rem`}
          aria-current={active ? "location" : undefined}
          onclick={(event) => jump(event, heading.id)}
        >
          {heading.text}
        </a>
      </li>
    {/each}
  </ol>
</nav>
