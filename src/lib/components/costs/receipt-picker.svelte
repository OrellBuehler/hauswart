<script lang="ts">
  import CameraIcon from "@lucide/svelte/icons/camera";
  import FileTextIcon from "@lucide/svelte/icons/file-text";
  import FileUpIcon from "@lucide/svelte/icons/file-up";
  import LoaderCircleIcon from "@lucide/svelte/icons/loader-circle";
  import XIcon from "@lucide/svelte/icons/x";
  import { formatBytes } from "$lib/attachments/files";
  import { browserConverter } from "$lib/attachments/receipt-convert";
  import {
    RECEIPT_CAMERA_ACCEPT,
    RECEIPT_PICK_ACCEPT,
    prepareReceiptFile,
    receiptProblemMessage,
  } from "$lib/attachments/receipt-file";
  import { Button } from "$lib/components/ui/button/index.js";
  import { m } from "$lib/paraglide/messages";
  import { cn } from "$lib/utils";

  /**
   * Takes a photo of a receipt (the camera on a phone) or a file (photo or PDF) and hands back one file ready to upload. A
   * HEIC photo is turned into a JPEG here when the browser can decode it, else it is refused in the server's own words.
   */
  let {
    id,
    file = $bindable(null),
    disabled = false,
    error,
    class: className,
  }: {
    id: string;
    file?: File | null;
    disabled?: boolean;
    /** A problem from the page (the receipt is required, the upload failed ...). */
    error?: string | undefined;
    class?: string;
  } = $props();

  let cameraInput = $state<HTMLInputElement | null>(null);
  let fileInput = $state<HTMLInputElement | null>(null);
  let converting = $state(false);
  let converted = $state(false);
  let problem = $state<string | undefined>();

  const isImage = $derived(file?.type.startsWith("image/") ?? false);
  const shownError = $derived(problem ?? error);

  let previewUrl = $state<string | null>(null);
  $effect(() => {
    if (!file || !isImage) {
      previewUrl = null;
      return;
    }
    const url = URL.createObjectURL(file);
    previewUrl = url;
    return () => URL.revokeObjectURL(url);
  });

  async function pick(event: Event) {
    const input = event.currentTarget as HTMLInputElement;
    const chosen = input.files?.[0];
    input.value = "";
    if (!chosen) return;
    problem = undefined;
    converting = true;
    try {
      const result = await prepareReceiptFile(chosen, browserConverter());
      if (result.ok) {
        file = result.file;
        converted = result.converted;
      } else {
        problem = receiptProblemMessage(result.problem);
      }
    } finally {
      converting = false;
    }
  }

  function remove() {
    file = null;
    converted = false;
    problem = undefined;
  }

  const describedby = $derived(shownError ? `${id}-error` : undefined);
</script>

<div class={cn("flex min-w-0 flex-col gap-2", className)}>
  <input
    bind:this={cameraInput}
    id={`${id}-camera`}
    type="file"
    class="sr-only"
    accept={RECEIPT_CAMERA_ACCEPT}
    capture="environment"
    tabindex="-1"
    aria-hidden="true"
    {disabled}
    onchange={pick}
  />
  <input
    bind:this={fileInput}
    id={`${id}-file`}
    type="file"
    class="sr-only"
    accept={RECEIPT_PICK_ACCEPT}
    tabindex="-1"
    aria-hidden="true"
    {disabled}
    onchange={pick}
  />

  {#if converting}
    <p
      class="bg-muted/50 text-muted-foreground flex min-h-14 items-center gap-3 rounded-xl border px-4 text-sm"
      role="status"
    >
      <LoaderCircleIcon class="size-5 animate-spin" aria-hidden="true" />
      {m.quick_receipt_converting()}
    </p>
  {:else if file}
    <div
      class="bg-card flex min-w-0 items-center gap-3 rounded-xl border p-2 pe-1"
    >
      {#if previewUrl}
        <img
          src={previewUrl}
          alt={m.quick_receipt_preview_alt()}
          class="bg-muted size-14 shrink-0 rounded-lg object-cover"
        />
      {:else}
        <span
          class="bg-muted text-muted-foreground flex size-14 shrink-0 items-center justify-center rounded-lg"
          aria-hidden="true"
        >
          <FileTextIcon class="size-6" />
        </span>
      {/if}
      <div class="min-w-0 flex-1">
        <p class="text-sm font-medium wrap-anywhere">{file.name}</p>
        <p class="text-muted-foreground text-xs tabular-nums">
          {formatBytes(file.size)}{#if converted}
            · {m.quick_receipt_converted()}{/if}
        </p>
      </div>
      <Button
        type="button"
        variant="ghost"
        size="icon-lg"
        aria-label={m.quick_receipt_remove()}
        {disabled}
        onclick={remove}
      >
        <XIcon />
      </Button>
    </div>
  {:else}
    <div class="grid grid-cols-1 gap-2 min-[400px]:grid-cols-2">
      <!-- The camera is only asked for on a touch screen; in CSS, so that the page does not move when it hydrates. -->
      <Button
        type="button"
        variant="outline"
        size="lg"
        class="hidden h-14 text-base pointer-coarse:inline-flex"
        aria-describedby={describedby}
        {disabled}
        onclick={() => cameraInput?.click()}
      >
        <CameraIcon class="size-5" />
        {m.quick_receipt_camera()}
      </Button>
      <Button
        type="button"
        variant="outline"
        size="lg"
        class="h-14 text-base min-[400px]:col-span-2 pointer-coarse:min-[400px]:col-span-1"
        aria-describedby={describedby}
        {disabled}
        onclick={() => fileInput?.click()}
      >
        <FileUpIcon class="size-5" />
        {m.quick_receipt_choose()}
      </Button>
    </div>
  {/if}

  {#if shownError}
    <p id={`${id}-error`} class="text-destructive text-xs text-pretty">
      {shownError}
    </p>
  {/if}
</div>
