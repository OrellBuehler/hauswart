<script lang="ts">
  import FileTextIcon from "@lucide/svelte/icons/file-text";
  import { untrack } from "svelte";
  import UploadIcon from "@lucide/svelte/icons/upload";
  import type { Attachment } from "$lib/api/schemas/attachments";
  import { Button } from "$lib/components/ui/button/index.js";
  import * as Dialog from "$lib/components/ui/dialog/index.js";
  import { Skeleton } from "$lib/components/ui/skeleton/index.js";
  import { formatBytes, isImage } from "$lib/attachments/files";
  import type { AttachmentList } from "$lib/attachments/list.svelte";
  import { m } from "$lib/paraglide/messages";

  let {
    open = $bindable(false),
    list,
    onpick,
    onupload,
  }: {
    open?: boolean;
    list: AttachmentList;
    onpick: (attachments: Attachment[]) => void;
    /** Chosen files to upload and insert. */
    onupload: (files: File[]) => void;
  } = $props();

  let input = $state<HTMLInputElement | null>(null);

  $effect(() => {
    if (open) {
      untrack(() => {
        if (list.phase === "idle") void list.load();
      });
    }
  });

  const images = $derived(list.items.filter(isImage));
  const files = $derived(list.items.filter((a) => !isImage(a)));

  function pick(attachment: Attachment) {
    open = false;
    onpick([attachment]);
  }
</script>

<Dialog.Root bind:open>
  <Dialog.Content
    class="max-h-[calc(100svh-2rem)] gap-4 overflow-y-auto sm:max-w-xl"
  >
    <Dialog.Header>
      <Dialog.Title>{m.editor_attachment_title()}</Dialog.Title>
      <Dialog.Description
        >{m.editor_attachment_description()}</Dialog.Description
      >
    </Dialog.Header>

    {#if list.phase === "loading" || list.phase === "idle"}
      <div
        class="grid grid-cols-3 gap-2"
        role="status"
        aria-label={m.common_loading()}
      >
        {#each [0, 1, 2] as n (n)}
          <Skeleton class="aspect-square rounded-lg" />
        {/each}
      </div>
    {:else}
      {#if images.length > 0}
        <ul
          class="grid grid-cols-3 gap-2 sm:grid-cols-4"
          aria-label={m.attach_images()}
        >
          {#each images as attachment (attachment.id)}
            <li>
              <button
                type="button"
                class="bg-muted focus-visible:ring-ring/60 hover:ring-brand/60 block aspect-square w-full overflow-hidden rounded-lg border outline-none hover:ring-2 focus-visible:ring-[3px]"
                aria-label={m.editor_attachment_insert_aria({
                  name: attachment.caption || attachment.filename,
                })}
                onclick={() => pick(attachment)}
              >
                <img
                  src={attachment.thumbUrl ?? attachment.url}
                  alt=""
                  loading="lazy"
                  class="size-full object-cover"
                />
              </button>
            </li>
          {/each}
        </ul>
      {/if}
      {#if files.length > 0}
        <ul
          class="divide-y rounded-lg border"
          aria-label={m.attach_documents()}
        >
          {#each files as attachment (attachment.id)}
            <li>
              <button
                type="button"
                class="hover:bg-accent/50 focus-visible:ring-ring/50 flex min-h-12 w-full items-center gap-3 px-3 py-2 text-start outline-none focus-visible:ring-[3px] focus-visible:ring-inset"
                onclick={() => pick(attachment)}
              >
                <FileTextIcon
                  class="text-destructive size-5 shrink-0"
                  aria-hidden="true"
                />
                <span class="min-w-0 flex-1 truncate text-sm">
                  {attachment.caption || attachment.filename}
                </span>
                <span
                  class="text-muted-foreground shrink-0 text-xs tabular-nums"
                >
                  {formatBytes(attachment.size)}
                </span>
              </button>
            </li>
          {/each}
        </ul>
      {/if}
      {#if list.items.length === 0}
        <p class="text-muted-foreground text-sm">
          {m.editor_attachment_empty()}
        </p>
      {/if}
    {/if}

    <Dialog.Footer>
      <Button
        type="button"
        size="lg"
        variant="outline"
        onclick={() => input?.click()}
      >
        <UploadIcon />{m.editor_attachment_upload()}
      </Button>
    </Dialog.Footer>
    <input
      bind:this={input}
      type="file"
      multiple
      accept="image/jpeg,image/png,image/webp,application/pdf"
      class="sr-only"
      tabindex="-1"
      aria-hidden="true"
      onchange={(event) => {
        const el = event.currentTarget;
        const chosen = [...(el.files ?? [])];
        el.value = "";
        if (chosen.length > 0) {
          open = false;
          onupload(chosen);
        }
      }}
    />
  </Dialog.Content>
</Dialog.Root>
