<script lang="ts">
  import InfoIcon from "@lucide/svelte/icons/info";
  import LoaderCircleIcon from "@lucide/svelte/icons/loader-circle";
  import { untrack } from "svelte";
  import { goto, invalidateAll } from "$app/navigation";
  import { resolve } from "$app/paths";
  import { toast } from "svelte-sonner";
  import { api } from "$lib/api/browser";
  import { AI_TASK_NOTE_MAX } from "$lib/api/schemas/ai-tasks";
  import { endpoints } from "$lib/api/registry";
  import type { Asset } from "$lib/api/schemas/assets";
  import type { CostBook } from "$lib/api/schemas/cost-books";
  import { uploadErrorMessage } from "$lib/attachments/errors";
  import FormAlert from "$lib/components/app/form-alert.svelte";
  import Field from "$lib/components/tasks/field.svelte";
  import OptionSelect from "$lib/components/tasks/option-select.svelte";
  import { Button } from "$lib/components/ui/button/index.js";
  import { Label } from "$lib/components/ui/label/index.js";
  import { Textarea } from "$lib/components/ui/textarea/index.js";
  import { bookIconFor, openBooks } from "$lib/costs/books";
  import {
    buildReceiptTaskBody,
    isKeyConflict,
    quickErrorMessage,
    type ReceiptDraft,
  } from "$lib/costs/quick";
  import { apiErrorMessage } from "$lib/error-message";
  import { isApiError } from "$lib/api/errors";
  import { newIdempotencyKey } from "$lib/idempotency";
  import { m } from "$lib/paraglide/messages";
  import { apiFieldErrors } from "$lib/tasks/field-errors";
  import { cn } from "$lib/utils";
  import ChoiceChips from "./choice-chips.svelte";
  import ReceiptPicker from "./receipt-picker.svelte";

  let {
    books,
    assets,
  }: {
    /** Every cost book, archived ones included (only open ones are offered). */
    books: CostBook[];
    assets: Asset[];
  } = $props();

  /** The choice that leaves the book to whoever reads the receipt. */
  const OPEN = "__open__";
  const BOOK_CHIPS_MAX = 5;

  let draft = $state<ReceiptDraft>({ note: "", bookId: "", assetId: "" });
  let bookChoice = $state<string>(OPEN);
  let file = $state<File | null>(null);
  /**
   * Names this receipt's upload. The same upload sent again (a request that got no answer) returns the task the first one
   * queued; a new key is taken after the task is queued, when another photo is picked, and when the server says another
   * receipt has this key.
   */
  let idempotencyKey = $state(newIdempotencyKey());
  let errors = $state<Record<string, string>>({});
  let formError = $state<string | undefined>();
  /** The upload got no answer: nothing is known about the task, and the receipt list is where to look. */
  let noAnswer = $state(false);
  let busy = $state(false);

  $effect(() => {
    void file;
    untrack(() => {
      idempotencyKey = newIdempotencyKey();
    });
  });

  const open = $derived(openBooks(books));
  const bookOptions = $derived([
    { value: OPEN, label: m.quick_receipt_book_open() },
    ...open.map((b) => ({
      value: b.id,
      label: b.name,
      icon: bookIconFor(b.icon),
    })),
  ]);
  const assetOptions = $derived([
    { value: "", label: m.cost_no_asset() },
    ...assets.map((a) => ({
      value: a.id,
      label: a.roomName ? `${a.name} (${a.roomName})` : a.name,
    })),
  ]);
  let formEl = $state<HTMLFormElement | null>(null);

  function focusFirstError() {
    queueMicrotask(() => {
      const invalid = formEl?.querySelector<HTMLElement>(
        "[aria-invalid='true']",
      );
      invalid?.scrollIntoView({ block: "center" });
      invalid?.focus();
    });
  }

  async function undo(id: string) {
    try {
      await api.call(endpoints.aiTasksDelete, { params: { id } });
      toast.success(m.quick_receipt_undone_toast());
      await invalidateAll();
    } catch (err) {
      toast.error(apiErrorMessage(err));
    }
  }

  async function submit(event: SubmitEvent) {
    event.preventDefault();
    if (busy) return;
    formError = undefined;
    noAnswer = false;
    const built = buildReceiptTaskBody(
      { ...draft, bookId: bookChoice === OPEN ? "" : bookChoice },
      file,
      idempotencyKey,
    );
    errors = built.errors;
    if (!built.body) {
      formError = m.form_check_fields();
      focusFirstError();
      return;
    }
    busy = true;
    try {
      const task = await api.call(endpoints.aiTasksCreate, {
        body: built.body,
      });
      toast.success(m.quick_receipt_sent_toast(), {
        duration: 10_000,
        action: { label: m.common_undo(), onClick: () => void undo(task.id) },
        cancel: {
          label: m.quick_receipt_another(),
          onClick: () => void goto(resolve("/costs/quick?mode=receipt" as "/")),
        },
      });
      idempotencyKey = newIdempotencyKey();
      await goto(resolve("/costs/receipts"), { invalidateAll: true });
    } catch (err) {
      errors = apiFieldErrors(err);
      noAnswer = !isApiError(err) && err instanceof TypeError;
      formError =
        isApiError(err) && !isKeyConflict(err)
          ? uploadErrorMessage(err)
          : quickErrorMessage(err, "receipt");
      // Only a key that stands for another receipt is spent; for every other failure the same key is right for the retry.
      if (isKeyConflict(err)) idempotencyKey = newIdempotencyKey();
      focusFirstError();
    } finally {
      busy = false;
    }
  }
</script>

<form
  bind:this={formEl}
  class="flex flex-col gap-6"
  onsubmit={submit}
  novalidate
>
  <p
    class="bg-muted/50 text-muted-foreground flex items-start gap-2 rounded-lg border px-3 py-2.5 text-sm text-pretty"
  >
    <InfoIcon class="mt-0.5 size-4 shrink-0" aria-hidden="true" />
    <span class="min-w-0">{m.quick_receipt_explainer()}</span>
  </p>

  <div class="flex min-w-0 flex-col gap-2">
    <span class="text-sm leading-none font-medium"
      >{m.quick_receipt_file()}</span
    >
    <ReceiptPicker
      id="queue-receipt"
      bind:file
      disabled={busy}
      error={errors.file}
    />
  </div>

  <Field
    id="queue-note"
    label={m.quick_receipt_note()}
    optional
    hint={m.quick_receipt_note_hint()}
    error={errors.note}
  >
    {#snippet children({ describedby, invalid })}
      <Textarea
        id="queue-note"
        rows={3}
        maxlength={AI_TASK_NOTE_MAX}
        disabled={busy}
        aria-invalid={invalid || undefined}
        aria-describedby={describedby}
        bind:value={draft.note}
      />
    {/snippet}
  </Field>

  {#if open.length > 1}
    <div class="flex min-w-0 flex-col gap-2">
      <span class="text-sm leading-none font-medium"
        >{m.cost_book()}
        <span class="text-muted-foreground font-normal"
          >({m.common_optional()})</span
        ></span
      >
      {#if open.length <= BOOK_CHIPS_MAX}
        <ChoiceChips
          options={bookOptions}
          label={m.cost_book()}
          bind:value={bookChoice}
          disabled={busy}
        />
      {:else}
        <OptionSelect
          id="queue-book"
          bind:value={bookChoice}
          options={bookOptions}
          disabled={busy}
        />
      {/if}
      <p class="text-muted-foreground text-xs text-pretty">
        {m.quick_receipt_book_hint()}
      </p>
    </div>
  {/if}

  <div class="flex min-w-0 flex-col gap-2">
    <Label for="queue-asset"
      >{m.cost_asset()}
      <span class="text-muted-foreground font-normal"
        >({m.common_optional()})</span
      ></Label
    >
    <OptionSelect
      id="queue-asset"
      bind:value={draft.assetId}
      options={assetOptions}
      disabled={busy}
    />
  </div>

  <div
    class={cn(
      "bg-background/90 sticky bottom-0 z-10 -mx-4 flex flex-col gap-3 border-t px-4 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] backdrop-blur",
      "md:mx-0 md:rounded-xl md:border md:pb-3",
    )}
  >
    <FormAlert message={formError} />
    {#if noAnswer}
      <a
        href={resolve("/costs/receipts?status=pending" as "/")}
        class="text-foreground focus-visible:ring-ring/50 inline-flex min-h-10 w-fit items-center rounded text-sm font-medium underline underline-offset-4 outline-none focus-visible:ring-[3px]"
        >{m.quick_receipt_check_list()}</a
      >
    {/if}
    <div class="flex gap-2">
      <Button
        href={resolve("/costs")}
        variant="outline"
        size="lg"
        class={cn(
          "h-12 shrink-0 pointer-coarse:h-12",
          busy && "pointer-events-none opacity-50",
        )}
      >
        {m.common_cancel()}
      </Button>
      <Button
        type="submit"
        size="lg"
        class="h-12 min-w-0 flex-1 text-base pointer-coarse:h-12"
        disabled={busy}
      >
        {#if busy}
          <LoaderCircleIcon class="animate-spin" />{m.quick_receipt_sending()}
        {:else}
          {m.quick_receipt_submit()}
        {/if}
      </Button>
    </div>
  </div>
</form>
