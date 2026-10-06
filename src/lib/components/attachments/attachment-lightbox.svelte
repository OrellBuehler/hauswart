<script lang="ts">
  import ChevronLeftIcon from "@lucide/svelte/icons/chevron-left";
  import ChevronRightIcon from "@lucide/svelte/icons/chevron-right";
  import DownloadIcon from "@lucide/svelte/icons/download";
  import ExternalLinkIcon from "@lucide/svelte/icons/external-link";
  import XIcon from "@lucide/svelte/icons/x";
  import type { Attachment } from "$lib/api/schemas/attachments";
  import { Button } from "$lib/components/ui/button/index.js";
  import * as Dialog from "$lib/components/ui/dialog/index.js";
  import { m } from "$lib/paraglide/messages";
  import { contentHref, downloadHref } from "$lib/attachments/files";

  let {
    images,
    index = $bindable(null),
  }: {
    images: Attachment[];
    /** Position of the open image, or null while closed. */
    index?: number | null;
  } = $props();

  const SWIPE_DISTANCE = 48;

  let swipeStart: { x: number; y: number; id: number } | null = null;

  const open = $derived(index !== null && images.length > 0);
  const current = $derived(
    index !== null
      ? (images[Math.min(index, images.length - 1)] ?? null)
      : null,
  );
  const position = $derived(
    index !== null ? Math.min(index, images.length - 1) : 0,
  );

  $effect(() => {
    if (index !== null && images.length === 0) index = null;
  });

  function step(delta: number) {
    if (index === null || images.length < 2) return;
    index = (position + delta + images.length) % images.length;
  }

  function onkeydown(event: KeyboardEvent) {
    if (!open) return;
    if (event.key === "ArrowLeft") {
      event.preventDefault();
      step(-1);
    } else if (event.key === "ArrowRight") {
      event.preventDefault();
      step(1);
    }
  }

  function onpointerdown(event: PointerEvent) {
    if (event.pointerType === "mouse" && event.button !== 0) return;
    swipeStart = { x: event.clientX, y: event.clientY, id: event.pointerId };
  }

  function onpointerup(event: PointerEvent) {
    if (!swipeStart || swipeStart.id !== event.pointerId) return;
    const dx = event.clientX - swipeStart.x;
    const dy = event.clientY - swipeStart.y;
    swipeStart = null;
    if (Math.abs(dx) >= SWIPE_DISTANCE && Math.abs(dx) > Math.abs(dy) * 1.5) {
      step(dx < 0 ? 1 : -1);
    }
  }
</script>

<svelte:window {onkeydown} />

<Dialog.Root
  bind:open={() => open, (value) => (index = value ? (index ?? 0) : null)}
>
  <Dialog.Content
    showCloseButton={false}
    class="top-0 left-0 h-dvh max-h-none w-dvw max-w-none translate-x-0 translate-y-0 grid-rows-[auto_1fr_auto] gap-0 rounded-none border-0 bg-black/95 p-0 text-white sm:max-w-none"
  >
    <Dialog.Header class="sr-only">
      <Dialog.Title>{current?.caption || current?.filename}</Dialog.Title>
      <Dialog.Description>{m.lightbox_description()}</Dialog.Description>
    </Dialog.Header>

    <div class="flex items-center justify-between gap-2 px-3 py-2">
      <p class="text-sm text-white/80 tabular-nums" aria-live="polite">
        {m.lightbox_position({ position: position + 1, total: images.length })}
      </p>
      <div class="flex items-center gap-1">
        {#if current}
          <Button
            variant="ghost"
            size="icon-lg"
            class="text-white hover:bg-white/15 hover:text-white"
            href={contentHref(current)}
            target="_blank"
            rel="noopener"
            aria-label={m.attach_open_new_tab()}
          >
            <ExternalLinkIcon />
          </Button>
          <Button
            variant="ghost"
            size="icon-lg"
            class="text-white hover:bg-white/15 hover:text-white"
            href={downloadHref(current)}
            download=""
            data-sveltekit-reload
            aria-label={m.attach_download()}
          >
            <DownloadIcon />
          </Button>
        {/if}
        <Dialog.Close>
          {#snippet child({ props })}
            <Button
              {...props}
              variant="ghost"
              size="icon-lg"
              class="text-white hover:bg-white/15 hover:text-white"
              aria-label={m.common_close()}
            >
              <XIcon />
            </Button>
          {/snippet}
        </Dialog.Close>
      </div>
    </div>

    <div
      class="relative flex min-h-0 touch-pan-y items-center justify-center px-2 select-none"
      {onpointerdown}
      {onpointerup}
      onpointercancel={() => (swipeStart = null)}
      role="presentation"
    >
      {#if current}
        {#key current.id}
          <img
            src={current.url}
            alt={current.caption || current.filename}
            class="animate-in fade-in max-h-full max-w-full rounded object-contain duration-200 motion-reduce:animate-none"
            draggable="false"
          />
        {/key}
      {/if}
      {#if images.length > 1}
        <Button
          variant="ghost"
          size="icon-lg"
          class="absolute start-2 top-1/2 size-11 -translate-y-1/2 rounded-full bg-black/40 text-white hover:bg-black/60 hover:text-white max-sm:hidden"
          aria-label={m.lightbox_previous()}
          onclick={() => step(-1)}
        >
          <ChevronLeftIcon />
        </Button>
        <Button
          variant="ghost"
          size="icon-lg"
          class="absolute end-2 top-1/2 size-11 -translate-y-1/2 rounded-full bg-black/40 text-white hover:bg-black/60 hover:text-white max-sm:hidden"
          aria-label={m.lightbox_next()}
          onclick={() => step(1)}
        >
          <ChevronRightIcon />
        </Button>
      {/if}
    </div>

    <div class="min-h-12 px-4 py-3 text-center">
      {#if current?.caption}
        <p class="mx-auto max-w-prose text-sm text-balance text-white/90">
          {current.caption}
        </p>
      {:else if current}
        <p class="text-xs text-white/60">{current.filename}</p>
      {/if}
    </div>
  </Dialog.Content>
</Dialog.Root>
