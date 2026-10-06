<script lang="ts">
  import { beforeNavigate, goto } from "$app/navigation";
  import { resolve } from "$app/paths";
  import FilePlusIcon from "@lucide/svelte/icons/file-plus";
  import ChevronDownIcon from "@lucide/svelte/icons/chevron-down";
  import LoaderCircleIcon from "@lucide/svelte/icons/loader-circle";
  import SlidersHorizontalIcon from "@lucide/svelte/icons/sliders-horizontal";
  import UploadIcon from "@lucide/svelte/icons/upload";
  import { onDestroy, untrack } from "svelte";
  import { MediaQuery } from "svelte/reactivity";
  import { toast } from "svelte-sonner";
  import { api } from "$lib/api/browser";
  import { isApiError } from "$lib/api/errors";
  import type { DocSection } from "$lib/api/enums";
  import { endpoints } from "$lib/api/registry";
  import type { Asset } from "$lib/api/schemas/assets";
  import type { Attachment } from "$lib/api/schemas/attachments";
  import type { DocPage, DocPageSummary } from "$lib/api/schemas/docs";
  import { PAGE_TITLE_MAX } from "$lib/api/schemas/docs";
  import type { Room } from "$lib/api/schemas/rooms";
  import {
    baseName,
    formatBytes,
    isImage,
    matchesAccept,
  } from "$lib/attachments/files";
  import { AttachmentList } from "$lib/attachments/list.svelte";
  import ConfirmDialog from "$lib/components/app/confirm-dialog.svelte";
  import FormAlert from "$lib/components/app/form-alert.svelte";
  import PageHeader from "$lib/components/app/page-header.svelte";
  import SwitchField from "$lib/components/app/switch-field.svelte";
  import OptionSelect from "$lib/components/assets/option-select.svelte";
  import RoomPicker from "$lib/components/assets/room-picker.svelte";
  import Attachments from "$lib/components/attachments/attachments.svelte";
  import Field from "$lib/components/tasks/field.svelte";
  import Segmented from "$lib/components/tasks/segmented.svelte";
  import { Button } from "$lib/components/ui/button/index.js";
  import * as Card from "$lib/components/ui/card/index.js";
  import { Input } from "$lib/components/ui/input/index.js";
  import { Skeleton } from "$lib/components/ui/skeleton/index.js";
  import { Textarea } from "$lib/components/ui/textarea/index.js";
  import {
    continueList,
    insertBlock,
    insertLink,
    insertText,
    setHeading,
    toggleBullet,
    toggleNumbered,
    toggleTask,
    wrapSelection,
    type Edit,
  } from "$lib/docs/editing";
  import { currentRevOf, pageErrorMessage } from "$lib/docs/errors";
  import { docEditHref, docHref } from "$lib/docs/links";
  import { DOC_SECTIONS, sectionLabels } from "$lib/docs/sections";
  import { m } from "$lib/paraglide/messages";
  import { cn } from "$lib/utils";
  import AttachmentInsertDialog from "./attachment-insert-dialog.svelte";
  import DocConflictDialog from "./doc-conflict-dialog.svelte";
  import DocProse from "./doc-prose.svelte";
  import EditorToolbar, { type ToolbarAction } from "./editor-toolbar.svelte";
  import WikiLinkDialog from "./wiki-link-dialog.svelte";

  let {
    page,
    defaults = {},
    assets,
    rooms,
    pages,
  }: {
    /** The page being edited; without it the editor creates a new one. */
    page?: DocPage | undefined;
    defaults?: {
      section?: DocSection | undefined;
      assetId?: string | undefined;
      roomId?: string | undefined;
      title?: string | undefined;
    };
    assets: Asset[];
    rooms: Room[];
    pages: DocPageSummary[];
  } = $props();

  const PREVIEW_DELAY_MS = 500;
  const WARN_BYTES = 150 * 1024;
  const MAX_BYTES = 200 * 1024;

  const initial = untrack(() => page);
  const start = untrack(() => defaults);
  const isNew = initial === undefined;

  let title = $state(initial?.title ?? start.title ?? "");
  let section = $state<DocSection>(
    initial?.section ?? start.section ?? "general",
  );
  let assetId = $state<string | null>(
    initial?.assetId ?? start.assetId ?? null,
  );
  let roomId = $state<string | null>(initial?.roomId ?? start.roomId ?? null);
  let pinned = $state(initial?.pinned ?? false);
  let guestVisible = $state(initial?.guestVisible ?? false);
  let body = $state(initial?.bodyMd ?? "");
  /** The revision the edits are based on; the next save sends it. */
  let baseRev = $state(initial?.rev ?? 0);

  const fields = () => ({
    title: title.trim(),
    section,
    assetId,
    roomId,
    pinned,
    guestVisible,
    bodyMd: body,
  });
  type Fields = ReturnType<typeof fields>;
  let saved = $state.raw<Fields>(untrack(() => fields()));
  const changed = $derived.by(() => {
    const now = fields();
    return (Object.keys(now) as (keyof Fields)[]).filter(
      (key) => now[key] !== saved[key],
    );
  });
  const dirty = $derived(changed.length > 0);

  let saving = $state(false);
  let saveError = $state<string | undefined>();
  let titleError = $state<string | undefined>();
  let titleEl = $state<HTMLInputElement | null>(null);
  let textarea = $state<HTMLTextAreaElement | null>(null);
  let view = $state<"write" | "preview">("write");
  let leaving = false;
  let leaveOpen = $state(false);
  let leaveTarget: URL | null = null;
  let conflictOpen = $state(false);
  let conflictRev = $state<number | undefined>();
  let conflictBusy = $state(false);
  let conflictError = $state<string | undefined>();
  let wikiOpen = $state(false);
  let insertOpen = $state(false);
  let settingsOpen = $state(isNew);
  let dropping = $state(false);
  let dropDepth = 0;

  const desktop = new MediaQuery("min-width: 1280px");
  const list = initial ? new AttachmentList("page", initial.id) : null;
  onDestroy(() => list?.destroy());

  const bytes = $derived(new TextEncoder().encode(body).length);

  /* ---- preview ---- */
  let previewHtml = $state(initial?.renderedHtml ?? "");
  let previewError = $state<string | undefined>();
  let previewPending = $state(false);
  let previewed = initial?.bodyMd ?? "";
  let previewRun = 0;
  const previewVisible = $derived(desktop.current || view === "preview");

  async function runPreview(text: string) {
    const run = ++previewRun;
    previewPending = true;
    try {
      const result = await api.call(endpoints.pagesPreview, {
        body: { bodyMd: text },
      });
      if (run !== previewRun) return;
      previewHtml = result.html;
      previewed = text;
      previewError = undefined;
    } catch (err) {
      if (run !== previewRun) return;
      previewError = pageErrorMessage(err);
    } finally {
      if (run === previewRun) previewPending = false;
    }
  }

  $effect(() => {
    const text = body;
    if (!previewVisible) return;
    if (text === previewed && !previewError) return;
    const timer = setTimeout(() => void runPreview(text), PREVIEW_DELAY_MS);
    return () => clearTimeout(timer);
  });

  /* ---- editing the text ---- */
  function applyEdit(edit: Edit) {
    const el = textarea;
    if (!el) return;
    el.focus();
    el.setSelectionRange(edit.from, edit.to);
    const done =
      edit.insert === ""
        ? edit.from === edit.to || document.execCommand("delete")
        : document.execCommand("insertText", false, edit.insert);
    if (!done) {
      el.setRangeText(edit.insert, edit.from, edit.to, "end");
      el.dispatchEvent(new Event("input", { bubbles: true }));
    }
    el.setSelectionRange(edit.selectFrom, edit.selectTo);
  }

  function selection(): [number, number] {
    const el = textarea;
    return el
      ? [el.selectionStart, el.selectionEnd]
      : [body.length, body.length];
  }

  function act(action: ToolbarAction) {
    const el = textarea;
    if (!el) return;
    const [start, end] = selection();
    const value = el.value;
    switch (action) {
      case "bold":
        return applyEdit(
          wrapSelection(
            value,
            start,
            end,
            "**",
            "**",
            m.editor_placeholder_bold(),
          ),
        );
      case "italic":
        return applyEdit(
          wrapSelection(
            value,
            start,
            end,
            "*",
            "*",
            m.editor_placeholder_italic(),
          ),
        );
      case "h2":
        return applyEdit(setHeading(value, start, 2));
      case "h3":
        return applyEdit(setHeading(value, start, 3));
      case "bullet":
        return applyEdit(toggleBullet(value, start, end));
      case "numbered":
        return applyEdit(toggleNumbered(value, start, end));
      case "task":
        return applyEdit(toggleTask(value, start, end));
      case "link":
        return applyEdit(
          insertLink(
            value,
            start,
            end,
            m.editor_placeholder_link(),
            "https://",
          ),
        );
      case "info":
        return applyEdit(
          insertBlock(value, start, end, "info", m.editor_placeholder_info()),
        );
      case "warning":
        return applyEdit(
          insertBlock(
            value,
            start,
            end,
            "warning",
            m.editor_placeholder_warning(),
          ),
        );
      case "secret":
        return applyEdit(
          insertBlock(
            value,
            start,
            end,
            "secret",
            m.editor_placeholder_secret(),
          ),
        );
      case "wiki":
        wikiOpen = true;
        return;
      case "attachment":
        if (!list) return needSave();
        insertOpen = true;
        return;
    }
  }

  function insertWiki(target: { slug: string; title: string; isNew: boolean }) {
    const el = textarea;
    const [start, end] = selection();
    const label = el ? el.value.slice(start, end) : "";
    const text = target.isNew
      ? label
        ? `[[${target.slug}|${label}]]`
        : `[[${target.slug}]]`
      : `[[${target.slug}|${label || target.title}]]`;
    applyEdit(insertText(el?.value ?? body, start, end, text));
  }

  function onkeydown(event: KeyboardEvent) {
    if (event.isComposing) return;
    const mod = event.metaKey || event.ctrlKey;
    if (mod && !event.shiftKey && !event.altKey) {
      if (event.key === "b") {
        event.preventDefault();
        act("bold");
      } else if (event.key === "i") {
        event.preventDefault();
        act("italic");
      }
      return;
    }
    if (event.key === "Enter" && !event.shiftKey && !event.altKey && !mod) {
      const el = event.currentTarget as HTMLTextAreaElement;
      const edit = continueList(el.value, el.selectionStart, el.selectionEnd);
      if (edit) {
        event.preventDefault();
        applyEdit(edit);
      }
    }
  }

  function onwindowkeydown(event: KeyboardEvent) {
    if (
      (event.metaKey || event.ctrlKey) &&
      !event.shiftKey &&
      event.key === "s"
    ) {
      event.preventDefault();
      void save({ stay: true });
    }
  }

  /* ---- images and files ---- */
  function needSave() {
    toast.info(m.editor_save_first(), {
      action: {
        label: m.editor_save_now(),
        onClick: () => void save({ stay: true }),
      },
    });
  }

  function markdownFor(attachment: Attachment): string {
    if (isImage(attachment)) {
      const alt =
        attachment.caption ||
        (/^image\d*$/i.test(baseName(attachment.filename))
          ? m.editor_alt_default()
          : baseName(attachment.filename));
      return `![${alt}](attachment:${attachment.id})`;
    }
    return `[${attachment.caption || attachment.filename}](attachment:${attachment.id})`;
  }

  function insertAttachments(attachments: Attachment[], at?: [number, number]) {
    const el = textarea;
    if (!el || attachments.length === 0) return;
    const [start, end] = at
      ? [Math.min(at[0], el.value.length), Math.min(at[1], el.value.length)]
      : selection();
    const text = attachments.map(markdownFor).join("\n\n");
    const edit = insertText(el.value, start, end, text, true);
    applyEdit(edit);
  }

  async function addMedia(files: File[]) {
    if (!list) return needSave();
    const accepted = files.filter((file) =>
      matchesAccept(file, "image/*,application/pdf"),
    );
    if (accepted.length === 0) {
      toast.error(m.attach_error_unsupported_type());
      return;
    }
    const at = selection();
    const stored = await list.upload(accepted);
    insertAttachments(stored, at);
  }

  function onpaste(event: ClipboardEvent) {
    const data = event.clipboardData;
    if (!data) return;
    const images = [...data.files].filter((file) =>
      file.type.startsWith("image/"),
    );
    if (images.length === 0 || data.getData("text/plain").trim() !== "") return;
    event.preventDefault();
    void addMedia(images);
  }

  function hasFiles(event: DragEvent): boolean {
    return [...(event.dataTransfer?.types ?? [])].includes("Files");
  }

  function ondragenter(event: DragEvent) {
    if (!hasFiles(event)) return;
    dropDepth += 1;
    dropping = true;
  }

  function ondragleave() {
    dropDepth = Math.max(0, dropDepth - 1);
    if (dropDepth === 0) dropping = false;
  }

  function ondragover(event: DragEvent) {
    if (!hasFiles(event)) return;
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = "copy";
  }

  function ondrop(event: DragEvent) {
    dropDepth = 0;
    dropping = false;
    if (!hasFiles(event)) return;
    event.preventDefault();
    void addMedia([...(event.dataTransfer?.files ?? [])]);
  }

  /* ---- saving ---- */
  function markSaved() {
    saved = fields();
  }

  async function save(options: { stay?: boolean } = {}) {
    if (saving) return;
    if (!title.trim()) {
      titleError = m.docs_error_title_required();
      titleEl?.focus();
      return;
    }
    titleError = undefined;
    saveError = undefined;
    if (!isNew && !dirty) {
      if (options.stay) toast.info(m.editor_no_changes());
      else await leave(docHref(initial!.slug));
      return;
    }
    saving = true;
    try {
      if (isNew) {
        const created = await api.call(endpoints.pagesCreate, {
          body: { ...fields(), title: title.trim() },
        });
        markSaved();
        toast.success(m.docs_created_toast());
        await leave(
          options.stay ? docEditHref(created.slug) : docHref(created.slug),
        );
      } else {
        const now = fields();
        const patch: Partial<Fields> = {};
        for (const key of changed) Object.assign(patch, { [key]: now[key] });
        const next = await api.call(endpoints.pagesUpdate, {
          params: { slug: initial!.slug },
          body: { rev: baseRev, ...patch },
        });
        baseRev = next.rev;
        markSaved();
        if (options.stay) toast.success(m.editor_saved_toast());
        else {
          toast.success(m.docs_saved_toast());
          await leave(docHref(initial!.slug));
        }
      }
    } catch (err) {
      if (!isNew && isApiError(err) && err.code === "conflict") {
        conflictRev = currentRevOf(err);
        conflictError = undefined;
        conflictOpen = true;
      } else {
        saveError = pageErrorMessage(err);
      }
    } finally {
      saving = false;
    }
  }

  async function leave(href: ReturnType<typeof docHref>) {
    leaving = true;
    await goto(href, { invalidateAll: true });
    leaving = false;
  }

  /* ---- conflicts ---- */
  async function reloadTheirs() {
    conflictBusy = true;
    conflictError = undefined;
    try {
      const fresh = await api.call(endpoints.pagesGet, {
        params: { slug: initial!.slug },
      });
      title = fresh.title;
      section = fresh.section;
      assetId = fresh.assetId;
      roomId = fresh.roomId;
      pinned = fresh.pinned;
      guestVisible = fresh.guestVisible;
      body = fresh.bodyMd;
      baseRev = fresh.rev;
      previewHtml = fresh.renderedHtml;
      previewed = fresh.bodyMd;
      markSaved();
      conflictOpen = false;
      toast.success(m.editor_conflict_reloaded_toast({ rev: fresh.rev }));
    } catch (err) {
      conflictError = pageErrorMessage(err);
    } finally {
      conflictBusy = false;
    }
  }

  async function keepMine() {
    conflictBusy = true;
    conflictError = undefined;
    try {
      let rev = conflictRev;
      if (rev === undefined) {
        const fresh = await api.call(endpoints.pagesGet, {
          params: { slug: initial!.slug },
        });
        rev = fresh.rev;
      }
      baseRev = rev;
      conflictOpen = false;
    } catch (err) {
      conflictError = pageErrorMessage(err);
      conflictBusy = false;
      return;
    }
    conflictBusy = false;
    await save({ stay: false });
  }

  async function copyMine() {
    try {
      await navigator.clipboard.writeText(body);
      toast.success(m.editor_conflict_copied_toast());
    } catch (err) {
      console.error("clipboard write failed", err);
      toast.error(m.common_copy_failed());
    }
  }

  /* ---- leaving with unsaved changes ---- */
  beforeNavigate((navigation) => {
    if (!dirty || leaving) return;
    navigation.cancel();
    if (navigation.type === "leave" || !navigation.to) return;
    leaveTarget = navigation.to.url;
    leaveOpen = true;
  });

  async function discard() {
    const target = leaveTarget;
    leaving = true;
    if (target) {
      await goto(
        resolve((target.pathname + target.search + target.hash) as "/"),
      );
    }
    leaving = false;
  }

  function cancel() {
    const back = isNew ? resolve("/docs") : docHref(initial!.slug);
    void goto(back);
  }

  const sectionOptions = DOC_SECTIONS.map((value) => ({
    value,
    label: sectionLabels[value](),
  }));
  const assetOptions = $derived(
    assets
      .filter((a) => !a.archivedAt || a.id === assetId)
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((a) => ({ value: a.id, label: a.name })),
  );
  const wikiPages = $derived(
    pages
      .filter((p) => p.id !== initial?.id && !p.archivedAt)
      .sort((a, b) => a.title.localeCompare(b.title)),
  );
  const settingsSummary = $derived(
    [
      sectionLabels[section](),
      assets.find((a) => a.id === assetId)?.name,
      rooms.find((r) => r.id === roomId)?.name,
      pinned ? m.docs_pinned() : null,
      guestVisible ? m.docs_guest_visible_short() : null,
    ]
      .filter(Boolean)
      .join(" · "),
  );
  const heading = $derived(
    isNew ? m.editor_new_title() : m.editor_edit_title(),
  );
</script>

<svelte:window onkeydown={onwindowkeydown} />

<svelte:head>
  <title>{heading} · {m.app_name()}</title>
</svelte:head>

<div class="flex flex-col gap-4">
  <div
    class="bg-background/90 sticky top-12 z-10 -mx-4 flex items-center justify-between gap-2 border-b px-4 py-2 backdrop-blur-md md:-mx-8 md:px-8"
  >
    <Button type="button" variant="ghost" onclick={cancel}>
      {m.common_cancel()}
    </Button>
    <div class="flex items-center gap-3">
      {#if dirty}
        <span
          class="text-warning flex items-center gap-1.5 text-xs font-medium"
        >
          <span class="bg-warning size-1.5 rounded-full" aria-hidden="true"
          ></span>
          <span class="max-sm:sr-only">{m.editor_unsaved()}</span>
        </span>
      {/if}
      <Button
        type="button"
        disabled={saving}
        onclick={() => save()}
        title={m.editor_save_shortcut()}
      >
        {#if saving}
          <LoaderCircleIcon class="animate-spin" />{m.common_saving()}
        {:else}
          {m.common_save()}
        {/if}
      </Button>
    </div>
  </div>

  <PageHeader title={heading} />

  <FormAlert message={saveError} />

  <Card.Root>
    <Card.Content class="flex flex-col gap-5">
      <Field id="doc-title" label={m.docs_field_title()} error={titleError}>
        {#snippet children({ describedby, invalid })}
          <Input
            id="doc-title"
            bind:ref={titleEl}
            bind:value={title}
            maxlength={PAGE_TITLE_MAX}
            autocomplete="off"
            aria-describedby={describedby}
            aria-invalid={invalid}
            class="text-base font-medium"
            oninput={() => (titleError = undefined)}
          />
        {/snippet}
      </Field>
      <button
        type="button"
        class="focus-visible:ring-ring/50 -my-1 flex min-h-11 items-center gap-2 rounded-lg border px-3 text-start text-sm outline-none focus-visible:ring-[3px] sm:hidden"
        aria-expanded={settingsOpen}
        aria-controls="doc-settings"
        onclick={() => (settingsOpen = !settingsOpen)}
      >
        <SlidersHorizontalIcon
          class="text-muted-foreground size-4 shrink-0"
          aria-hidden="true"
        />
        <span class="min-w-0 flex-1">
          <span class="block font-medium">{m.editor_settings()}</span>
          <span class="text-muted-foreground block truncate text-xs">
            {settingsSummary}
          </span>
        </span>
        <ChevronDownIcon
          class={cn(
            "text-muted-foreground size-4 shrink-0 transition-transform",
            settingsOpen && "rotate-180",
          )}
          aria-hidden="true"
        />
      </button>
      <div
        id="doc-settings"
        class={cn("flex flex-col gap-5", !settingsOpen && "max-sm:hidden")}
      >
        <div class="grid gap-4 sm:grid-cols-3">
          <Field id="doc-section" label={m.docs_field_section()}>
            <OptionSelect
              id="doc-section"
              options={sectionOptions}
              bind:value={() => section, (value) => value && (section = value)}
            />
          </Field>
          <Field id="doc-asset" label={m.docs_field_asset()} optional>
            <OptionSelect
              id="doc-asset"
              options={assetOptions}
              bind:value={assetId}
              noneLabel={m.docs_field_none()}
            />
          </Field>
          <Field id="doc-room" label={m.docs_field_room()} optional>
            <RoomPicker
              id="doc-room"
              {rooms}
              bind:value={roomId}
              noneLabel={m.docs_field_none()}
            />
          </Field>
        </div>
        <div class="grid gap-4 sm:grid-cols-2">
          <SwitchField
            id="doc-pinned"
            bind:checked={pinned}
            label={m.docs_field_pinned()}
            hint={m.docs_field_pinned_hint()}
          />
          <SwitchField
            id="doc-guest"
            bind:checked={guestVisible}
            label={m.docs_field_guest()}
            hint={m.docs_field_guest_hint()}
          />
        </div>
      </div>
    </Card.Content>
  </Card.Root>

  <div class="flex flex-col gap-2">
    <Segmented
      class="xl:hidden"
      label={m.editor_view()}
      options={[
        { value: "write", label: m.editor_tab_write() },
        { value: "preview", label: m.editor_tab_preview() },
      ]}
      bind:value={view}
    />
    <div class="grid items-stretch gap-4 xl:grid-cols-2">
      <div
        class={cn(
          "bg-card shadow-card relative flex min-w-0 flex-col overflow-hidden rounded-xl border xl:h-[calc(100svh-15rem)] xl:min-h-[30rem]",
          view !== "write" && "max-xl:hidden",
        )}
        {ondragenter}
        {ondragleave}
        {ondragover}
        {ondrop}
        role="group"
        aria-label={m.editor_text()}
      >
        <EditorToolbar onaction={act} />
        <Textarea
          id="doc-editor-text"
          bind:ref={textarea}
          bind:value={body}
          class="field-sizing-fixed h-[58svh] min-h-72 resize-none rounded-none border-0 bg-transparent p-4 font-mono text-sm leading-relaxed shadow-none focus-visible:ring-0 xl:h-auto xl:min-h-0 xl:flex-1 dark:bg-transparent"
          placeholder={m.editor_placeholder()}
          aria-label={m.editor_text()}
          spellcheck="false"
          {onkeydown}
          {onpaste}
        />
        <div
          class="text-muted-foreground flex min-h-9 items-center justify-between gap-3 border-t px-3 py-1.5 text-xs"
        >
          <span class="flex min-w-0 items-center gap-1.5 truncate">
            {#if list?.uploading}
              <LoaderCircleIcon
                class="size-3.5 shrink-0 animate-spin"
                aria-hidden="true"
              />
              {m.editor_uploading()}
            {:else}
              <span class="max-sm:hidden">{m.editor_markdown_hint()}</span>
            {/if}
          </span>
          <span
            class={cn(
              "shrink-0 tabular-nums",
              bytes > WARN_BYTES && "text-warning font-medium",
              bytes > MAX_BYTES && "text-destructive",
            )}
          >
            {formatBytes(bytes)}{bytes > WARN_BYTES
              ? ` / ${formatBytes(MAX_BYTES)}`
              : ""}
          </span>
        </div>
        {#if dropping}
          <div
            class="bg-background/80 text-brand pointer-events-none absolute inset-0 z-10 flex items-center justify-center text-sm font-medium backdrop-blur-[1px]"
          >
            <UploadIcon
              class="me-2 size-4"
              aria-hidden="true"
            />{m.editor_drop_here()}
          </div>
        {/if}
      </div>

      <section
        class={cn(
          "bg-card shadow-card flex min-w-0 flex-col overflow-hidden rounded-xl border xl:h-[calc(100svh-15rem)] xl:min-h-[30rem]",
          view !== "preview" && "max-xl:hidden",
        )}
        aria-label={m.editor_preview()}
        aria-busy={previewPending}
      >
        <div
          class="text-muted-foreground flex h-[2.875rem] shrink-0 items-center justify-between gap-2 border-b px-4 text-xs font-medium max-xl:hidden"
        >
          {m.editor_preview()}
          {#if previewPending}
            <LoaderCircleIcon
              class="size-3.5 animate-spin"
              aria-label={m.common_loading()}
            />
          {/if}
        </div>
        <div
          class="min-h-72 flex-1 overflow-y-auto p-4 xl:min-h-0"
          aria-live="polite"
        >
          {#if previewError}
            <div class="mb-3"><FormAlert message={previewError} /></div>
          {/if}
          {#if previewHtml.trim()}
            <DocProse
              html={previewHtml}
              class={cn(previewPending && "opacity-70 transition-opacity")}
            />
          {:else if previewPending}
            <div
              class="flex flex-col gap-2"
              role="status"
              aria-label={m.common_loading()}
            >
              <Skeleton class="h-5 w-1/2" />
              <Skeleton class="h-4 w-full" />
              <Skeleton class="h-4 w-4/5" />
            </div>
          {:else}
            <p class="text-muted-foreground text-sm">
              {m.editor_preview_empty()}
            </p>
          {/if}
        </div>
      </section>
    </div>
  </div>

  {#if list && initial}
    <Attachments
      ownerType="page"
      ownerId={initial.id}
      controller={list}
      title={m.docs_attachments_title()}
      oninsert={(attachment) => {
        view = "write";
        insertAttachments([attachment]);
      }}
    />
  {:else}
    <Card.Root>
      <Card.Header>
        <Card.Title>{m.docs_attachments_title()}</Card.Title>
        <Card.Description>{m.editor_new_uploads_hint()}</Card.Description>
      </Card.Header>
      <Card.Content>
        <Button
          type="button"
          variant="outline"
          size="lg"
          disabled={saving}
          onclick={() => save({ stay: true })}
        >
          <FilePlusIcon />{m.editor_save_first_action()}
        </Button>
      </Card.Content>
    </Card.Root>
  {/if}
</div>

<WikiLinkDialog bind:open={wikiOpen} pages={wikiPages} onpick={insertWiki} />

{#if list}
  <AttachmentInsertDialog
    bind:open={insertOpen}
    {list}
    onpick={(attachments) => insertAttachments(attachments)}
    onupload={(files) => void addMedia(files)}
  />
{/if}

<DocConflictDialog
  bind:open={conflictOpen}
  myRev={baseRev}
  currentRev={conflictRev}
  pending={conflictBusy}
  error={conflictError}
  onreload={reloadTheirs}
  onkeep={keepMine}
  oncopy={copyMine}
/>

<ConfirmDialog
  bind:open={leaveOpen}
  title={m.editor_leave_title()}
  description={m.editor_leave_description()}
  confirmLabel={m.editor_leave_confirm()}
  pendingLabel={m.editor_leave_confirm()}
  destructive
  onconfirm={discard}
/>
