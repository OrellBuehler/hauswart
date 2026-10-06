<script lang="ts">
  import LoaderCircleIcon from "@lucide/svelte/icons/loader-circle";
  import FormAlert from "$lib/components/app/form-alert.svelte";
  import { Button } from "$lib/components/ui/button/index.js";
  import * as Dialog from "$lib/components/ui/dialog/index.js";
  import { Input } from "$lib/components/ui/input/index.js";
  import { Label } from "$lib/components/ui/label/index.js";
  import { Textarea } from "$lib/components/ui/textarea/index.js";
  import {
    addDays,
    addMonths,
    isoWeekStart,
    zonedTimeToInstant,
  } from "$lib/dates";
  import { apiErrorMessage } from "$lib/error-message";
  import { formatDateShort } from "$lib/format";
  import { m } from "$lib/paraglide/messages";
  import { completeTask, skipTask, snoozeTask } from "$lib/tasks/actions";

  let {
    open = $bindable(false),
    mode,
    task,
    today,
    timeZone,
  }: {
    open?: boolean;
    mode: "complete" | "skip" | "snooze";
    task: { id: string; title: string; snoozedUntil?: string | null };
    today: string;
    /** The household's zone; needed to backdate a completion. */
    timeZone?: string | undefined;
  } = $props();

  let note = $state("");
  let date = $state("");
  let pending = $state(false);
  let error = $state<string | undefined>();

  const tomorrow = $derived(addDays(today, 1));
  const presets = $derived([
    { label: m.snooze_tomorrow(), date: tomorrow },
    { label: m.snooze_three_days(), date: addDays(today, 3) },
    { label: m.snooze_next_week(), date: addDays(isoWeekStart(today), 7) },
    { label: m.snooze_next_month(), date: addMonths(today, 1) },
  ]);

  $effect(() => {
    if (!open) return;
    note = "";
    date = mode === "snooze" ? addDays(today, 3) : today;
    error = undefined;
  });

  const title = $derived(
    mode === "complete"
      ? m.task_complete_dialog_title()
      : mode === "skip"
        ? m.task_skip_dialog_title()
        : m.task_snooze_dialog_title(),
  );
  const description = $derived(
    mode === "complete"
      ? m.task_complete_dialog_description({ title: task.title })
      : mode === "skip"
        ? m.task_skip_dialog_description({ title: task.title })
        : m.task_snooze_dialog_description({ title: task.title }),
  );
  const submitLabel = $derived(
    mode === "complete"
      ? m.task_complete()
      : mode === "skip"
        ? m.task_skip()
        : m.task_snooze_submit(),
  );

  async function submit(event: SubmitEvent) {
    event.preventDefault();
    if (pending) return;
    if (mode === "snooze" && (!date || date <= today)) {
      error = m.task_snooze_future();
      return;
    }
    if (mode === "complete" && date > today) {
      error = m.task_complete_future();
      return;
    }
    pending = true;
    error = undefined;
    try {
      if (mode === "complete") {
        const backdated = date && date < today && timeZone;
        await completeTask(task, {
          note: note.trim() || null,
          ...(backdated
            ? {
                completedAt: new Date(
                  zonedTimeToInstant(date, "12:00", timeZone),
                ).toISOString(),
              }
            : {}),
        });
      } else if (mode === "skip") {
        await skipTask(task, note.trim() || null);
      } else {
        await snoozeTask(task, date, task.snoozedUntil ?? null);
      }
      open = false;
    } catch (err) {
      error = apiErrorMessage(err);
    } finally {
      pending = false;
    }
  }
</script>

<Dialog.Root bind:open={() => open, (value) => (open = pending ? true : value)}>
  <Dialog.Content class="max-h-[calc(100svh-2rem)] overflow-y-auto">
    <Dialog.Header>
      <Dialog.Title>{title}</Dialog.Title>
      <Dialog.Description>{description}</Dialog.Description>
    </Dialog.Header>
    <form class="flex flex-col gap-5" onsubmit={submit}>
      {#if mode === "snooze"}
        <div class="flex flex-col gap-2">
          <span class="text-sm font-medium" id="snooze-presets"
            >{m.task_snooze_quick()}</span
          >
          <div
            class="flex flex-wrap gap-2"
            role="group"
            aria-labelledby="snooze-presets"
          >
            {#each presets as preset (preset.label)}
              <Button
                type="button"
                size="lg"
                variant={date === preset.date ? "default" : "outline"}
                aria-pressed={date === preset.date}
                onclick={() => (date = preset.date)}
              >
                {preset.label}
              </Button>
            {/each}
          </div>
        </div>
        <div class="flex flex-col gap-2">
          <Label for="action-date">{m.task_snooze_until()}</Label>
          <Input
            id="action-date"
            type="date"
            required
            min={tomorrow}
            bind:value={date}
            class="h-10"
          />
          {#if date && date >= tomorrow}
            <p class="text-muted-foreground text-xs">
              {formatDateShort(date, { today })}
            </p>
          {/if}
        </div>
      {:else}
        {#if mode === "complete"}
          <div class="flex flex-col gap-2">
            <Label for="action-date">{m.task_complete_date()}</Label>
            <Input
              id="action-date"
              type="date"
              required
              max={today}
              bind:value={date}
              class="h-10"
            />
            <p class="text-muted-foreground text-xs">
              {m.task_complete_date_hint()}
            </p>
          </div>
        {/if}
        <div class="flex flex-col gap-2">
          <Label for="action-note">
            {m.task_note()}
            <span class="text-muted-foreground font-normal"
              >({m.common_optional()})</span
            >
          </Label>
          <Textarea
            id="action-note"
            rows={3}
            maxlength={2000}
            bind:value={note}
          />
        </div>
      {/if}
      <FormAlert message={error} />
      <Dialog.Footer class="gap-2">
        <Button
          type="button"
          variant="outline"
          size="lg"
          disabled={pending}
          onclick={() => (open = false)}
        >
          {m.common_cancel()}
        </Button>
        <Button type="submit" size="lg" disabled={pending}>
          {#if pending}
            <LoaderCircleIcon class="animate-spin" />
          {/if}
          {submitLabel}
        </Button>
      </Dialog.Footer>
    </form>
  </Dialog.Content>
</Dialog.Root>
