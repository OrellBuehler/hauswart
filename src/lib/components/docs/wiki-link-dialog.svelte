<script lang="ts">
  import FilePlusIcon from "@lucide/svelte/icons/file-plus";
  import FileTextIcon from "@lucide/svelte/icons/file-text";
  import type { DocPageSummary } from "$lib/api/schemas/docs";
  import * as Command from "$lib/components/ui/command/index.js";
  import { sectionLabels } from "$lib/docs/sections";
  import { m } from "$lib/paraglide/messages";

  let {
    open = $bindable(false),
    pages,
    onpick,
  }: {
    open?: boolean;
    pages: DocPageSummary[];
    /** `slug` is the target as `[[slug|label]]` writes it; a new page has no slug yet and passes its title. */
    onpick: (target: { slug: string; title: string; isNew: boolean }) => void;
  } = $props();

  let search = $state("");

  $effect(() => {
    if (open) search = "";
  });

  const query = $derived(search.trim());
  const exact = $derived(
    pages.some((p) => p.title.toLowerCase() === query.toLowerCase()),
  );
</script>

<Command.Dialog
  bind:open
  title={m.editor_wiki_title()}
  description={m.editor_wiki_description()}
>
  <Command.Input
    bind:value={search}
    placeholder={m.editor_wiki_placeholder()}
    aria-label={m.editor_wiki_placeholder()}
  />
  <Command.List>
    <Command.Empty>{m.editor_wiki_empty()}</Command.Empty>
    <Command.Group heading={m.editor_wiki_pages()}>
      {#each pages as page (page.id)}
        <Command.Item
          value={`${page.title} ${page.slug}`}
          onSelect={() => {
            open = false;
            onpick({ slug: page.slug, title: page.title, isNew: false });
          }}
        >
          <FileTextIcon aria-hidden="true" />
          <span class="min-w-0 flex-1">
            <span class="block truncate">{page.title}</span>
            <span class="text-muted-foreground block truncate text-xs">
              {sectionLabels[page.section]()} · {page.slug}
            </span>
          </span>
        </Command.Item>
      {/each}
    </Command.Group>
    {#if query && !exact}
      <Command.Group heading={m.editor_wiki_new_group()}>
        <Command.Item
          value={`__new ${query}`}
          forceMount
          onSelect={() => {
            open = false;
            onpick({ slug: query, title: query, isNew: true });
          }}
        >
          <FilePlusIcon aria-hidden="true" />
          <span class="min-w-0 flex-1 truncate">
            {m.editor_wiki_new({ title: query })}
          </span>
        </Command.Item>
      </Command.Group>
    {/if}
  </Command.List>
</Command.Dialog>
