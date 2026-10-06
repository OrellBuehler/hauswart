<script lang="ts">
  import LoaderCircleIcon from "@lucide/svelte/icons/loader-circle";
  import { untrack } from "svelte";
  import { goto } from "$app/navigation";
  import { resolve } from "$app/paths";
  import { toast } from "svelte-sonner";
  import {
    NOTIFY_MODES,
    TASK_CATEGORIES,
    TASK_PRIORITIES,
    type AssignMode,
    type NotifyMode,
    type RotationStrategy,
    type TaskCategory,
    type TaskPriority,
  } from "$lib/api/enums";
  import { api } from "$lib/api/browser";
  import { endpoints } from "$lib/api/registry";
  import type { Asset } from "$lib/api/schemas/assets";
  import type { Room } from "$lib/api/schemas/rooms";
  import {
    TASK_TITLE_MAX,
    createTaskRequestSchema,
    updateTaskRequestSchema,
    type CreateTaskRequest,
    type TaskDetail,
    type UpdateTaskRequest,
  } from "$lib/api/schemas/tasks";
  import type { DirectoryUser } from "$lib/api/schemas/users";
  import FormAlert from "$lib/components/app/form-alert.svelte";
  import { Button } from "$lib/components/ui/button/index.js";
  import * as Card from "$lib/components/ui/card/index.js";
  import { Input } from "$lib/components/ui/input/index.js";
  import { Textarea } from "$lib/components/ui/textarea/index.js";
  import { apiErrorMessage } from "$lib/error-message";
  import { taskHref } from "$lib/links";
  import { m } from "$lib/paraglide/messages";
  import type { PreparationDraft } from "$lib/tasks/draft";
  import {
    apiFieldErrors,
    errorsUnder,
    issuesToErrors,
  } from "$lib/tasks/field-errors";
  import {
    categoryLabels,
    notifyModeLabels,
    priorityLabels,
  } from "$lib/tasks/labels";
  import AssignmentEditor from "./assignment-editor.svelte";
  import Field from "./field.svelte";
  import NumberField from "./number-field.svelte";
  import OptionSelect from "./option-select.svelte";
  import PreparationEditor from "./preparation-editor.svelte";
  import Segmented from "./segmented.svelte";
  import TriggerBuilder from "./trigger-builder/trigger-builder.svelte";
  import {
    defaultTrigger,
    draftOf,
    type TriggerDraft,
  } from "./trigger-builder/types";
  import TriggerPreview from "./trigger-preview.svelte";

  let {
    task,
    people,
    rooms,
    assets,
    today,
    dueSoonDefault,
    defaults = {},
  }: {
    task?: TaskDetail | undefined;
    people: DirectoryUser[];
    rooms: Room[];
    assets: Asset[];
    today: string;
    dueSoonDefault: number;
    defaults?: { assetId?: string | undefined; roomId?: string | undefined };
  } = $props();

  const init = untrack(() => ({
    title: task?.title ?? "",
    description: task?.descriptionMd ?? "",
    category: (task?.category ?? "maintenance") as TaskCategory,
    priority: (task?.priority ?? "normal") as TaskPriority,
    effort: task?.effortMinutes ?? undefined,
    assetId: task?.assetId ?? defaults.assetId ?? "",
    roomId: task?.roomId ?? defaults.roomId ?? "",
    trigger: task ? draftOf(task.trigger) : defaultTrigger("interval", today),
    assignMode: (task?.assignMode ?? "none") as AssignMode,
    assigneeUserId: task?.assigneeUserId ?? "",
    rotationOrder: task ? [...task.rotationOrder] : ([] as string[]),
    rotationStrategy: (task?.rotationStrategy ??
      "alternate") as RotationStrategy,
    notifyMode: (task?.notifyMode ?? "assignee") as NotifyMode,
    graceDays: task?.graceDays ?? 0,
    dueSoonDays: task?.dueSoonDays ?? undefined,
    preparations: (task?.preparations ?? []).map((p): PreparationDraft => ({
      key: p.id,
      id: p.id,
      title: p.title,
      kind: p.kind,
      leadDays: p.leadDays ?? undefined,
    })),
  }));

  let title = $state(init.title);
  let description = $state(init.description);
  let category = $state<TaskCategory>(init.category);
  let priority = $state<TaskPriority>(init.priority);
  let effort = $state<number | undefined>(init.effort);
  let assetId = $state(init.assetId);
  let roomId = $state(init.roomId);
  let trigger = $state<TriggerDraft>(init.trigger);
  let assignMode = $state<AssignMode>(init.assignMode);
  let assigneeUserId = $state(init.assigneeUserId);
  let rotationOrder = $state<string[]>(init.rotationOrder);
  let rotationStrategy = $state<RotationStrategy>(init.rotationStrategy);
  let notifyMode = $state<NotifyMode>(init.notifyMode);
  let graceDays = $state<number | undefined>(init.graceDays);
  let dueSoonDays = $state<number | undefined>(init.dueSoonDays);
  let preparations = $state<PreparationDraft[]>(init.preparations);

  let errors = $state<Record<string, string>>({});
  let formError = $state<string | undefined>();
  let pending = $state(false);
  let formEl = $state<HTMLFormElement | null>(null);

  const triggerErrors = $derived(errorsUnder(errors, "trigger"));

  const categoryOptions = $derived(
    TASK_CATEGORIES.map((c) => ({ value: c, label: categoryLabels[c]() })),
  );
  const priorityOptions = $derived(
    TASK_PRIORITIES.map((p) => ({ value: p, label: priorityLabels[p]() })),
  );
  const notifyOptions = $derived(
    NOTIFY_MODES.map((n) => ({ value: n, label: notifyModeLabels[n]() })),
  );
  const assetOptions = $derived([
    { value: "", label: m.task_no_asset() },
    ...assets.map((a) => ({
      value: a.id,
      label: a.roomName ? `${a.name} (${a.roomName})` : a.name,
    })),
  ]);
  const roomOptions = $derived([
    { value: "", label: m.task_no_room() },
    ...rooms.map((r) => ({ value: r.id, label: r.name })),
  ]);

  function requestBody() {
    return {
      title: title.trim(),
      descriptionMd: description,
      category,
      priority,
      effortMinutes: effort ?? null,
      assetId: assetId || null,
      roomId: roomId || null,
      trigger: $state.snapshot(trigger),
      assignMode,
      assigneeUserId: assignMode === "fixed" ? assigneeUserId || null : null,
      rotationOrder: assignMode === "rotate" ? [...rotationOrder] : [],
      rotationStrategy,
      notifyMode,
      graceDays: graceDays ?? 0,
      dueSoonDays: dueSoonDays ?? null,
    };
  }

  function validate(body: ReturnType<typeof requestBody>) {
    const schema = task ? updateTaskRequestSchema : createTaskRequestSchema;
    const result = schema.safeParse(body);
    const found = result.success
      ? {}
      : issuesToErrors(result.error.issues, body);
    if (assignMode === "fixed" && !assigneeUserId) {
      found.assigneeUserId = m.field_required();
    }
    if (assignMode === "rotate" && rotationOrder.length === 0) {
      found.rotationOrder = m.field_choose_one();
    }
    for (const prep of preparations) {
      if (!prep.title.trim()) {
        found[`prep.${prep.key}.title`] = m.field_required();
      }
      if (
        prep.leadDays !== undefined &&
        (!Number.isInteger(prep.leadDays) ||
          prep.leadDays < 0 ||
          prep.leadDays > 3650)
      ) {
        found[`prep.${prep.key}.leadDays`] = m.field_min({ min: 0 });
      }
    }
    return result.success && Object.keys(found).length === 0
      ? { data: result.data, errors: found }
      : { data: undefined, errors: found };
  }

  function focusFirstError() {
    queueMicrotask(() => {
      const invalid = formEl?.querySelector<HTMLElement>(
        "[aria-invalid='true']",
      );
      invalid?.scrollIntoView({ block: "center" });
      invalid?.focus();
    });
  }

  async function savePreparations(taskId: string): Promise<boolean> {
    const existing = new Map((task?.preparations ?? []).map((p) => [p.id, p]));
    let failed = false;
    const run = async (call: () => Promise<unknown>) => {
      try {
        await call();
      } catch (err) {
        failed = true;
        toast.error(apiErrorMessage(err));
      }
    };
    for (const id of existing.keys()) {
      if (!preparations.some((p) => p.id === id)) {
        await run(() =>
          api.call(endpoints.preparationsDelete, {
            params: { id: taskId, prepId: id },
          }),
        );
      }
    }
    for (const [index, prep] of preparations.entries()) {
      const body = {
        title: prep.title.trim(),
        kind: prep.kind,
        leadDays: prep.leadDays ?? null,
      };
      const before = prep.id ? existing.get(prep.id) : undefined;
      if (before) {
        if (
          before.title !== body.title ||
          before.kind !== body.kind ||
          before.leadDays !== body.leadDays
        ) {
          await run(() =>
            api.call(endpoints.preparationsUpdate, {
              params: { id: taskId, prepId: before.id },
              body,
            }),
          );
        }
      } else {
        await run(() =>
          api.call(endpoints.preparationsCreate, {
            params: { id: taskId },
            body: { ...body, sortOrder: index },
          }),
        );
      }
    }
    return !failed;
  }

  async function submit(event: SubmitEvent) {
    event.preventDefault();
    if (pending) return;
    formError = undefined;
    const body = requestBody();
    const { data, errors: found } = validate(body);
    errors = found;
    if (!data) {
      formError = m.task_form_fix_errors();
      focusFirstError();
      return;
    }
    pending = true;
    try {
      let saved: { id: string; title: string };
      if (task) {
        saved = await api.call(endpoints.tasksUpdate, {
          params: { id: task.id },
          body: data as UpdateTaskRequest,
        });
      } else {
        saved = await api.call(endpoints.tasksCreate, {
          body: data as CreateTaskRequest,
        });
      }
      const prepsOk = await savePreparations(saved.id);
      toast.success(
        task
          ? m.task_saved_toast({ title: saved.title })
          : m.task_created_toast({ title: saved.title }),
      );
      if (!prepsOk) toast.warning(m.task_form_preparations_failed());
      await goto(taskHref(saved.id), { invalidateAll: true });
    } catch (err) {
      errors = apiFieldErrors(err);
      formError = apiErrorMessage(err);
      focusFirstError();
    } finally {
      pending = false;
    }
  }
</script>

<form
  bind:this={formEl}
  class="flex flex-col gap-6"
  onsubmit={submit}
  novalidate
>
  <div
    class="grid items-start gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]"
  >
    <Card.Root class="lg:col-start-1">
      <Card.Header>
        <Card.Title>{m.task_form_basics()}</Card.Title>
      </Card.Header>
      <Card.Content class="flex flex-col gap-5">
        <Field
          id="task-title"
          label={m.task_title_label()}
          error={errors.title}
        >
          {#snippet children({ describedby, invalid })}
            <Input
              id="task-title"
              class="h-10"
              required
              maxlength={TASK_TITLE_MAX}
              autocomplete="off"
              placeholder={m.task_title_placeholder()}
              bind:value={title}
              aria-invalid={invalid || undefined}
              aria-describedby={describedby}
            />
          {/snippet}
        </Field>
        <Field
          id="task-description"
          label={m.task_description()}
          hint={m.task_description_hint()}
          optional
          error={errors.descriptionMd}
        >
          {#snippet children({ describedby, invalid })}
            <Textarea
              id="task-description"
              rows={4}
              maxlength={50000}
              bind:value={description}
              aria-invalid={invalid || undefined}
              aria-describedby={describedby}
            />
          {/snippet}
        </Field>
        <div class="grid gap-5 sm:grid-cols-2">
          <Field
            id="task-category"
            label={m.task_category()}
            error={errors.category}
          >
            {#snippet children({ describedby, invalid })}
              <OptionSelect
                id="task-category"
                bind:value={category}
                options={categoryOptions}
                {invalid}
                {describedby}
              />
            {/snippet}
          </Field>
          <Field
            id="task-effort"
            label={m.task_effort()}
            hint={m.task_effort_hint()}
            optional
            error={errors.effortMinutes}
          >
            {#snippet children({ describedby, invalid })}
              <NumberField
                id="task-effort"
                bind:value={effort}
                placeholder="15"
                {invalid}
                {describedby}
              />
            {/snippet}
          </Field>
        </div>
        <div class="flex flex-col gap-2">
          <span class="text-sm font-medium">{m.task_priority()}</span>
          <Segmented
            label={m.task_priority()}
            options={priorityOptions}
            bind:value={priority}
          />
        </div>
        <div class="grid gap-5 sm:grid-cols-2">
          <Field
            id="task-asset"
            label={m.task_asset()}
            optional
            error={errors.assetId}
          >
            {#snippet children({ describedby, invalid })}
              <OptionSelect
                id="task-asset"
                bind:value={assetId}
                options={assetOptions}
                {invalid}
                {describedby}
              />
            {/snippet}
          </Field>
          <Field
            id="task-room"
            label={m.task_room()}
            optional
            error={errors.roomId}
          >
            {#snippet children({ describedby, invalid })}
              <OptionSelect
                id="task-room"
                bind:value={roomId}
                options={roomOptions}
                {invalid}
                {describedby}
              />
            {/snippet}
          </Field>
        </div>
      </Card.Content>
    </Card.Root>

    <Card.Root class="lg:col-start-1">
      <Card.Header>
        <Card.Title>{m.task_form_schedule()}</Card.Title>
        <Card.Description>{m.task_form_schedule_description()}</Card.Description
        >
      </Card.Header>
      <Card.Content>
        <TriggerBuilder bind:trigger errors={triggerErrors} {today} />
      </Card.Content>
    </Card.Root>

    <div
      class="lg:sticky lg:top-16 lg:col-start-2 lg:row-span-4 lg:row-start-1"
    >
      <TriggerPreview {trigger} {graceDays} {dueSoonDays} {today} />
    </div>

    <Card.Root class="lg:col-start-1">
      <Card.Header>
        <Card.Title>{m.task_assignment()}</Card.Title>
      </Card.Header>
      <Card.Content>
        <AssignmentEditor
          bind:mode={assignMode}
          bind:assigneeUserId
          bind:rotationOrder
          bind:strategy={rotationStrategy}
          {people}
          {errors}
        />
      </Card.Content>
    </Card.Root>

    <Card.Root class="lg:col-start-1">
      <Card.Header>
        <Card.Title>{m.task_form_notifications()}</Card.Title>
      </Card.Header>
      <Card.Content class="grid gap-5 sm:grid-cols-3">
        <Field
          id="task-notify"
          label={m.task_notify()}
          error={errors.notifyMode}
        >
          {#snippet children({ describedby, invalid })}
            <OptionSelect
              id="task-notify"
              bind:value={notifyMode}
              options={notifyOptions}
              {invalid}
              {describedby}
            />
          {/snippet}
        </Field>
        <Field
          id="task-grace"
          label={m.task_grace_days()}
          hint={m.task_grace_days_hint()}
          error={errors.graceDays}
        >
          {#snippet children({ describedby, invalid })}
            <NumberField
              id="task-grace"
              bind:value={graceDays}
              {invalid}
              {describedby}
            />
          {/snippet}
        </Field>
        <Field
          id="task-soon"
          label={m.task_due_soon_days()}
          hint={m.task_due_soon_days_hint({ days: dueSoonDefault })}
          optional
          error={errors.dueSoonDays}
        >
          {#snippet children({ describedby, invalid })}
            <NumberField
              id="task-soon"
              bind:value={dueSoonDays}
              placeholder={String(dueSoonDefault)}
              {invalid}
              {describedby}
            />
          {/snippet}
        </Field>
      </Card.Content>
    </Card.Root>

    <Card.Root class="lg:col-start-1">
      <Card.Header>
        <Card.Title>{m.task_preparations()}</Card.Title>
        <Card.Description>{m.task_preparations_description()}</Card.Description>
      </Card.Header>
      <Card.Content>
        <PreparationEditor bind:preparations {errors} />
      </Card.Content>
    </Card.Root>
  </div>

  <div
    class="bg-background/90 sticky bottom-0 z-10 -mx-4 flex flex-col gap-3 border-t px-4 py-3 backdrop-blur md:-mx-8 md:px-8"
  >
    <FormAlert message={formError} />
    <div class="flex justify-end gap-2">
      <Button
        type="button"
        variant="outline"
        size="lg"
        disabled={pending}
        href={task ? taskHref(task.id) : resolve("/tasks")}
      >
        {m.common_cancel()}
      </Button>
      <Button type="submit" size="lg" disabled={pending}>
        {#if pending}
          <LoaderCircleIcon class="animate-spin" />
          {m.common_saving()}
        {:else if task}
          {m.common_save()}
        {:else}
          {m.common_create()}
        {/if}
      </Button>
    </div>
  </div>
</form>
