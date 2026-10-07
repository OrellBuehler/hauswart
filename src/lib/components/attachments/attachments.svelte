<script lang="ts">
  import CornerDownLeftIcon from "@lucide/svelte/icons/corner-down-left";
  import DownloadIcon from "@lucide/svelte/icons/download";
  import EllipsisVerticalIcon from "@lucide/svelte/icons/ellipsis-vertical";
  import ExternalLinkIcon from "@lucide/svelte/icons/external-link";
  import EyeIcon from "@lucide/svelte/icons/eye";
  import FileTextIcon from "@lucide/svelte/icons/file-text";
  import FileUpIcon from "@lucide/svelte/icons/file-up";
  import ImageIcon from "@lucide/svelte/icons/image";
  import ImagePlusIcon from "@lucide/svelte/icons/image-plus";
  import LoaderCircleIcon from "@lucide/svelte/icons/loader-circle";
  import PencilIcon from "@lucide/svelte/icons/pencil";
  import RefreshCwIcon from "@lucide/svelte/icons/refresh-cw";
  import StarIcon from "@lucide/svelte/icons/star";
  import StarOffIcon from "@lucide/svelte/icons/star-off";
  import Trash2Icon from "@lucide/svelte/icons/trash-2";
  import UploadIcon from "@lucide/svelte/icons/upload";
  import XIcon from "@lucide/svelte/icons/x";
  import { untrack } from "svelte";
  import { toast } from "svelte-sonner";
  import type { AttachmentOwnerType } from "$lib/api/enums";
  import type { Attachment } from "$lib/api/schemas/attachments";
  import ConfirmDialog from "$lib/components/app/confirm-dialog.svelte";
  import EmptyState from "$lib/components/app/empty-state.svelte";
  import FormAlert from "$lib/components/app/form-alert.svelte";
  import FormDialog from "$lib/components/app/form-dialog.svelte";
  import { Badge } from "$lib/components/ui/badge/index.js";
  import { Button } from "$lib/components/ui/button/index.js";
  import * as Card from "$lib/components/ui/card/index.js";
  import * as DropdownMenu from "$lib/components/ui/dropdown-menu/index.js";
  import { Input } from "$lib/components/ui/input/index.js";
  import { Label } from "$lib/components/ui/label/index.js";
  import { Progress } from "$lib/components/ui/progress/index.js";
  import { Skeleton } from "$lib/components/ui/skeleton/index.js";
  import {
    DEFAULT_ACCEPT,
    contentHref,
    downloadHref,
    formatBytes,
    isImage,
    isPdf,
  } from "$lib/attachments/files";
  import { AttachmentList } from "$lib/attachments/list.svelte";
  import { isLinkableOwner } from "$lib/documents/labels";
  import { isActive, pushes } from "$lib/documents/pushes.svelte";
  import { DocumentSystem } from "$lib/documents/system.svelte";
  import { CAPTION_MAX } from "$lib/api/schemas/attachments";
  import { apiErrorMessage } from "$lib/error-message";
  import { m } from "$lib/paraglide/messages";
  import { cn } from "$lib/utils";
  import AttachmentLightbox from "./attachment-lightbox.svelte";
  import PushJobs from "./push-jobs.svelte";
  import PushToDocumentsDialog from "./push-to-documents-dialog.svelte";

  /** Owners whose files a guest can be shown. */
  const GUEST_OWNERS: AttachmentOwnerType[] = [
    "asset",
    "room",
    "page",
    "task",
    "asset_hint",
  ];

  let {
    ownerType,
    ownerId,
    accept = DEFAULT_ACCEPT,
    editable = true,
    variant = "card",
    title,
    description,
    controller,
    primaryId,
    onprimary,
    oninsert,
    onchange,
    class: className,
  }: {
    ownerType: AttachmentOwnerType;
    ownerId: string;
    /** `accept` of the file picker: a comma separated list of types. */
    accept?: string;
    editable?: boolean;
    /** `card` has a header and an empty state; `compact` is a bare row of thumbnails. */
    variant?: "card" | "compact";
    title?: string;
    description?: string;
    /** A list owned by the caller (the page editor); otherwise the component keeps its own. */
    controller?: AttachmentList;
    /** The attachment that is the owner's main photo (assets). */
    primaryId?: string | null | undefined;
    /** Makes an image the main photo, or clears it with null. Setting it turns the actions on. */
    onprimary?: (attachment: Attachment | null) => Promise<void>;
    /** Adds an "insert" action (the page editor). */
    oninsert?: (attachment: Attachment) => void;
    /** After an upload, a change or a delete. */
    onchange?: () => void;
    class?: string;
  } = $props();

  const list = $derived(
    controller ??
      new AttachmentList(ownerType, ownerId, {
        accept,
        onchange: () => onchange?.(),
      }),
  );

  $effect(() => {
    const current = list;
    untrack(() => {
      if (current.phase === "idle") void current.load();
    });
    return () => {
      if (!controller) current.destroy();
    };
  });

  const system = new DocumentSystem();
  $effect(() => system.start());

  /** A file can be sent to the person's document system when they have one and the owner can be linked (a hint cannot). */
  const linkableOwner = $derived(
    isLinkableOwner(ownerType) ? ownerType : undefined,
  );
  const provider = $derived(system.provider);
  const canPush = $derived(editable && Boolean(provider) && linkableOwner);

  const compact = $derived(variant === "compact");
  const guestOwner = $derived(GUEST_OWNERS.includes(ownerType));
  const images = $derived(list.items.filter(isImage));
  const files = $derived(list.items.filter((a) => !isImage(a)));

  let input = $state<HTMLInputElement | null>(null);
  let dragging = $state(false);
  let dragDepth = 0;
  let lightbox = $state<number | null>(null);
  let captionTarget = $state<Attachment | undefined>();
  let captionOpen = $state(false);
  let caption = $state("");
  let deleteTarget = $state<Attachment | undefined>();
  let deleteOpen = $state(false);
  let busy = $state<string | null>(null);
  let pushTarget = $state<Attachment | undefined>();
  let pushOpen = $state(false);

  const pushing = (attachment: Attachment) =>
    pushes.jobs.some(
      (job) => job.attachmentId === attachment.id && isActive(job),
    );

  function askPush(attachment: Attachment) {
    pushTarget = attachment;
    pushOpen = true;
  }

  async function addFiles(chosen: File[]) {
    if (!editable || chosen.length === 0) return;
    await list.upload(chosen);
  }

  function onpick(event: Event) {
    const el = event.currentTarget as HTMLInputElement;
    const chosen = [...(el.files ?? [])];
    el.value = "";
    void addFiles(chosen);
  }

  function hasFiles(event: DragEvent): boolean {
    return [...(event.dataTransfer?.types ?? [])].includes("Files");
  }

  function ondragenter(event: DragEvent) {
    if (!editable || !hasFiles(event)) return;
    dragDepth += 1;
    dragging = true;
  }

  function ondragleave() {
    dragDepth = Math.max(0, dragDepth - 1);
    if (dragDepth === 0) dragging = false;
  }

  function ondragover(event: DragEvent) {
    if (!editable || !hasFiles(event)) return;
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = "copy";
  }

  function ondrop(event: DragEvent) {
    dragDepth = 0;
    dragging = false;
    if (!editable || !hasFiles(event)) return;
    event.preventDefault();
    void addFiles([...(event.dataTransfer?.files ?? [])]);
  }

  function openCaption(attachment: Attachment) {
    captionTarget = attachment;
    caption = attachment.caption ?? "";
    captionOpen = true;
  }

  async function saveCaption() {
    if (!captionTarget) return;
    await list.update(captionTarget.id, { caption: caption.trim() || null });
  }

  async function toggleGuest(attachment: Attachment) {
    if (busy) return;
    busy = attachment.id;
    try {
      await list.update(attachment.id, {
        guestVisible: !attachment.guestVisible,
      });
    } catch (err) {
      toast.error(apiErrorMessage(err));
    } finally {
      busy = null;
    }
  }

  async function setPrimary(attachment: Attachment | null) {
    if (busy || !onprimary) return;
    busy = attachment?.id ?? "primary";
    try {
      await onprimary(attachment);
      toast.success(
        attachment
          ? m.attach_primary_set_toast()
          : m.attach_primary_cleared_toast(),
      );
    } catch (err) {
      toast.error(apiErrorMessage(err));
    } finally {
      busy = null;
    }
  }

  function askDelete(attachment: Attachment) {
    deleteTarget = attachment;
    deleteOpen = true;
  }

  async function remove() {
    if (!deleteTarget) return;
    const { id } = deleteTarget;
    await list.remove(id);
    toast.success(m.attach_deleted_toast());
  }

  const label = (a: Attachment) => a.caption || a.filename;
</script>

{#snippet menu(attachment: Attachment, overlay: boolean)}
  {@const isPrimary = primaryId === attachment.id}
  <DropdownMenu.Root>
    <DropdownMenu.Trigger>
      {#snippet child({ props })}
        <Button
          {...props}
          variant={overlay ? "secondary" : "ghost"}
          size="icon-sm"
          class={cn(
            overlay &&
              "bg-background/85 hover:bg-background size-8 rounded-full shadow-sm backdrop-blur-sm",
          )}
          disabled={busy === attachment.id}
          aria-label={m.attach_actions_aria({ name: label(attachment) })}
        >
          <EllipsisVerticalIcon />
        </Button>
      {/snippet}
    </DropdownMenu.Trigger>
    <DropdownMenu.Content align="end" class="min-w-56">
      {#if oninsert}
        <DropdownMenu.Item
          class="min-h-10"
          onSelect={() => oninsert(attachment)}
        >
          <CornerDownLeftIcon />{m.attach_insert()}
        </DropdownMenu.Item>
      {/if}
      {#if onprimary && isImage(attachment) && editable}
        {#if isPrimary}
          <DropdownMenu.Item class="min-h-10" onSelect={() => setPrimary(null)}>
            <StarOffIcon />{m.attach_primary_clear()}
          </DropdownMenu.Item>
        {:else}
          <DropdownMenu.Item
            class="min-h-10"
            onSelect={() => setPrimary(attachment)}
          >
            <StarIcon />{m.attach_primary_set()}
          </DropdownMenu.Item>
        {/if}
      {/if}
      {#if editable}
        <DropdownMenu.Item
          class="min-h-10"
          onSelect={() => openCaption(attachment)}
        >
          <PencilIcon />{m.attach_edit_caption()}
        </DropdownMenu.Item>
        {#if guestOwner}
          <DropdownMenu.CheckboxItem
            class="min-h-10"
            checked={attachment.guestVisible}
            onCheckedChange={() => toggleGuest(attachment)}
          >
            {m.attach_guest_visible()}
          </DropdownMenu.CheckboxItem>
        {/if}
      {/if}
      <DropdownMenu.Item class="min-h-10">
        {#snippet child({ props })}
          <a
            {...props}
            href={contentHref(attachment)}
            target="_blank"
            rel="noopener"
          >
            <ExternalLinkIcon />{m.attach_open_new_tab()}
          </a>
        {/snippet}
      </DropdownMenu.Item>
      <DropdownMenu.Item class="min-h-10">
        {#snippet child({ props })}
          <a
            {...props}
            href={downloadHref(attachment)}
            download=""
            data-sveltekit-reload
          >
            <DownloadIcon />{m.attach_download()}
          </a>
        {/snippet}
      </DropdownMenu.Item>
      {#if canPush}
        <DropdownMenu.Item
          class="min-h-10"
          disabled={pushing(attachment)}
          onSelect={() => askPush(attachment)}
        >
          <FileUpIcon />{m.document_push_action()}
        </DropdownMenu.Item>
      {/if}
      {#if editable}
        <DropdownMenu.Separator />
        <DropdownMenu.Item
          variant="destructive"
          class="min-h-10"
          onSelect={() => askDelete(attachment)}
        >
          <Trash2Icon />{m.common_delete()}
        </DropdownMenu.Item>
      {/if}
    </DropdownMenu.Content>
  </DropdownMenu.Root>
{/snippet}

{#snippet uploadButton()}
  <Button
    type="button"
    size="sm"
    variant="outline"
    onclick={() => input?.click()}
  >
    {#if compact}
      <ImagePlusIcon />{m.attach_add_compact()}
    {:else}
      <UploadIcon />{m.attach_add()}
    {/if}
  </Button>
{/snippet}

{#snippet body()}
  <div
    class={cn(
      "relative flex flex-col gap-4 rounded-lg transition-colors",
      dragging && "ring-brand bg-brand/5 ring-2 ring-offset-4",
    )}
    {ondragenter}
    {ondragleave}
    {ondragover}
    {ondrop}
    role="group"
    aria-label={title ?? m.attach_title()}
  >
    {#if list.phase === "loading" || list.phase === "idle"}
      <div
        class={cn(
          "grid gap-3",
          compact ? "grid-cols-4" : "grid-cols-2 sm:grid-cols-3",
        )}
        role="status"
        aria-label={m.common_loading()}
      >
        {#each [0, 1, 2].slice(0, compact ? 2 : 3) as n (n)}
          <Skeleton
            class={compact ? "size-16 rounded-lg" : "aspect-square rounded-lg"}
          />
        {/each}
      </div>
    {:else if list.phase === "error"}
      <div class="flex flex-col items-start gap-3">
        <FormAlert message={list.loadError} />
        <Button variant="outline" onclick={() => list.load()}>
          {m.common_retry()}
        </Button>
      </div>
    {:else}
      {#if list.jobs.length > 0}
        <ul class="flex flex-col gap-2" aria-label={m.attach_uploads()}>
          {#each list.jobs as job (job.id)}
            <li
              class={cn(
                "flex items-center gap-3 rounded-lg border p-2.5",
                job.status === "error" &&
                  "border-destructive/40 bg-destructive/5",
              )}
            >
              <span
                class="bg-muted text-muted-foreground flex size-10 shrink-0 items-center justify-center overflow-hidden rounded-md"
                aria-hidden="true"
              >
                {#if job.previewUrl}
                  <img
                    src={job.previewUrl}
                    alt=""
                    class="size-full object-cover"
                  />
                {:else}
                  <FileTextIcon class="size-5" />
                {/if}
              </span>
              <div class="min-w-0 flex-1">
                <p class="truncate text-sm font-medium">{job.name}</p>
                {#if job.status === "uploading"}
                  <div class="mt-1.5 flex items-center gap-2">
                    <Progress
                      value={Math.round(job.progress * 100)}
                      class="h-1.5"
                      aria-label={m.attach_uploading_aria({ name: job.name })}
                    />
                    <span
                      class="text-muted-foreground w-9 shrink-0 text-end text-xs tabular-nums"
                    >
                      {Math.round(job.progress * 100)}%
                    </span>
                  </div>
                {:else}
                  <p class="text-destructive text-xs text-pretty" role="alert">
                    {job.error}
                  </p>
                {/if}
              </div>
              {#if job.status === "error"}
                <div class="flex shrink-0 items-center">
                  {#if job.retryable}
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label={m.attach_retry_aria({ name: job.name })}
                      onclick={() => list.retry(job.id)}
                    >
                      <RefreshCwIcon />
                    </Button>
                  {/if}
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label={m.attach_dismiss_aria({ name: job.name })}
                    onclick={() => list.dismiss(job.id)}
                  >
                    <XIcon />
                  </Button>
                </div>
              {:else}
                <LoaderCircleIcon
                  class="text-muted-foreground size-4 shrink-0 animate-spin"
                  aria-hidden="true"
                />
              {/if}
            </li>
          {/each}
        </ul>
      {/if}

      <PushJobs {ownerType} {ownerId} />

      {#if list.items.length === 0 && list.jobs.length === 0}
        {#if !compact}
          <EmptyState
            icon={ImageIcon}
            title={m.attach_empty_title()}
            description={editable
              ? m.attach_empty_body()
              : m.attach_empty_readonly()}
            class="py-8"
          >
            {#snippet actions()}
              {#if editable}
                <Button onclick={() => input?.click()}>
                  <UploadIcon />{m.attach_add()}
                </Button>
              {/if}
            {/snippet}
          </EmptyState>
        {/if}
      {/if}

      {#if images.length > 0}
        <ul
          class={cn(
            compact
              ? "flex flex-wrap gap-2"
              : "grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4",
          )}
          aria-label={m.attach_images()}
        >
          {#each images as attachment, index (attachment.id)}
            <li
              class={cn(
                "bg-muted group relative overflow-hidden rounded-lg border",
                compact ? "size-16" : "aspect-square",
              )}
            >
              <button
                type="button"
                class="focus-visible:ring-ring/60 block size-full cursor-zoom-in outline-none focus-visible:ring-[3px] focus-visible:ring-inset"
                aria-label={m.attach_view_aria({ name: label(attachment) })}
                onclick={() => (lightbox = index)}
              >
                <img
                  src={attachment.thumbUrl ?? attachment.url}
                  alt={label(attachment)}
                  loading="lazy"
                  decoding="async"
                  width={attachment.width ?? undefined}
                  height={attachment.height ?? undefined}
                  class="size-full object-cover transition-transform duration-200 group-hover:scale-[1.03] motion-reduce:transition-none"
                />
              </button>
              {#if !compact}
                {#if attachment.caption}
                  <div
                    class="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/70 to-transparent p-2 pt-8"
                  >
                    <span
                      class="line-clamp-2 text-xs text-pretty break-words text-white"
                    >
                      {attachment.caption}
                    </span>
                  </div>
                {/if}
                <div
                  class="pointer-events-none absolute start-1.5 top-1.5 flex flex-col items-start gap-1"
                >
                  {#if primaryId === attachment.id}
                    <Badge
                      class="bg-brand text-brand-foreground gap-1 shadow-sm"
                    >
                      <StarIcon
                        class="fill-current"
                        aria-hidden="true"
                      />{m.attach_primary_badge()}
                    </Badge>
                  {/if}
                  {#if attachment.guestVisible}
                    <Badge
                      variant="secondary"
                      class="bg-background/85 gap-1 shadow-sm backdrop-blur-sm"
                    >
                      <EyeIcon aria-hidden="true" />{m.attach_guest_badge()}
                    </Badge>
                  {/if}
                </div>
                <div class="absolute end-1.5 top-1.5">
                  {@render menu(attachment, true)}
                </div>
              {:else}
                <div
                  class="absolute end-0.5 top-0.5 opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100 max-sm:opacity-100"
                >
                  {@render menu(attachment, true)}
                </div>
              {/if}
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
            <li class="flex items-center gap-1 ps-3 pe-1.5">
              <a
                href={contentHref(attachment)}
                target="_blank"
                rel="noopener"
                class="hover:text-foreground focus-visible:ring-ring/50 flex min-h-14 min-w-0 flex-1 items-center gap-3 rounded-sm py-2 outline-none focus-visible:ring-[3px]"
              >
                <span
                  class="bg-destructive/10 text-destructive flex size-9 shrink-0 items-center justify-center rounded-md"
                  aria-hidden="true"
                >
                  <FileTextIcon class="size-4.5" />
                </span>
                <span class="min-w-0">
                  <span class="block truncate text-sm font-medium">
                    {label(attachment)}
                  </span>
                  <span
                    class="text-muted-foreground flex flex-wrap items-center gap-x-2 text-xs"
                  >
                    {#if attachment.caption}
                      <span class="max-w-40 truncate"
                        >{attachment.filename}</span
                      >
                    {/if}
                    <span>{isPdf(attachment) ? "PDF" : attachment.mime}</span>
                    <span class="tabular-nums"
                      >{formatBytes(attachment.size)}</span
                    >
                    {#if attachment.guestVisible}
                      <span class="inline-flex items-center gap-1">
                        <EyeIcon
                          class="size-3"
                          aria-hidden="true"
                        />{m.attach_guest_badge()}
                      </span>
                    {/if}
                  </span>
                </span>
                <ExternalLinkIcon
                  class="text-muted-foreground ms-auto size-4 shrink-0 max-sm:hidden"
                  aria-hidden="true"
                />
                <span class="sr-only">{m.attach_open_new_tab()}</span>
              </a>
              {@render menu(attachment, false)}
            </li>
          {/each}
        </ul>
      {/if}

      {#if compact && editable}
        <div>{@render uploadButton()}</div>
      {/if}
    {/if}
    {#if dragging}
      <div
        class="bg-background/70 text-brand pointer-events-none absolute inset-0 flex items-center justify-center rounded-lg text-sm font-medium backdrop-blur-[1px]"
      >
        <UploadIcon
          class="me-2 size-4"
          aria-hidden="true"
        />{m.attach_drop_here()}
      </div>
    {/if}
  </div>
{/snippet}

{#if compact}
  <div class={className}>
    {@render body()}
  </div>
{:else}
  <Card.Root class={className}>
    <Card.Header>
      <Card.Title>{title ?? m.attach_title()}</Card.Title>
      {#if description}
        <Card.Description>{description}</Card.Description>
      {/if}
      {#if editable && list.phase === "ready" && list.items.length + list.jobs.length > 0}
        <Card.Action>{@render uploadButton()}</Card.Action>
      {/if}
    </Card.Header>
    <Card.Content class="flex flex-col gap-3">
      {@render body()}
      {#if editable}
        <p class="text-muted-foreground text-xs text-pretty">
          {m.attach_hint({ size: formatBytes(25 * 1024 * 1024) })}
        </p>
      {/if}
    </Card.Content>
  </Card.Root>
{/if}

<input
  bind:this={input}
  type="file"
  multiple
  {accept}
  class="sr-only"
  tabindex="-1"
  aria-hidden="true"
  onchange={onpick}
/>

<AttachmentLightbox {images} bind:index={lightbox} />

{#if canPush && provider && linkableOwner}
  <PushToDocumentsDialog
    bind:open={pushOpen}
    attachment={pushTarget}
    ownerType={linkableOwner}
    {provider}
  />
{/if}

<FormDialog
  bind:open={captionOpen}
  title={m.attach_edit_caption()}
  description={captionTarget ? captionTarget.filename : undefined}
  submitLabel={m.common_save()}
  onsubmit={saveCaption}
>
  <div class="flex flex-col gap-2">
    <Label for="attachment-caption">{m.attach_caption_label()}</Label>
    <Input
      id="attachment-caption"
      bind:value={caption}
      maxlength={CAPTION_MAX}
      autocomplete="off"
      placeholder={m.attach_caption_placeholder()}
    />
  </div>
</FormDialog>

<ConfirmDialog
  bind:open={deleteOpen}
  title={m.attach_delete_title()}
  description={deleteTarget && primaryId === deleteTarget.id
    ? m.attach_delete_primary_description({
        name: deleteTarget ? label(deleteTarget) : "",
      })
    : m.attach_delete_description({
        name: deleteTarget ? label(deleteTarget) : "",
      })}
  confirmLabel={m.common_delete()}
  pendingLabel={m.common_deleting()}
  destructive
  onconfirm={remove}
/>
