<script lang="ts">
  import ArrowLeftIcon from "@lucide/svelte/icons/arrow-left";
  import BoxesIcon from "@lucide/svelte/icons/boxes";
  import CalendarClockIcon from "@lucide/svelte/icons/calendar-clock";
  import CalendarXIcon from "@lucide/svelte/icons/calendar-x";
  import CheckIcon from "@lucide/svelte/icons/check";
  import ContactIcon from "@lucide/svelte/icons/contact";
  import EllipsisVerticalIcon from "@lucide/svelte/icons/ellipsis-vertical";
  import InfoIcon from "@lucide/svelte/icons/info";
  import ListChecksIcon from "@lucide/svelte/icons/list-checks";
  import LoaderCircleIcon from "@lucide/svelte/icons/loader-circle";
  import MapPinIcon from "@lucide/svelte/icons/map-pin";
  import PencilIcon from "@lucide/svelte/icons/pencil";
  import RotateCcwIcon from "@lucide/svelte/icons/rotate-ccw";
  import Trash2Icon from "@lucide/svelte/icons/trash-2";
  import type { z } from "zod";
  import { invalidateAll } from "$app/navigation";
  import { resolve } from "$app/paths";
  import { toast } from "svelte-sonner";
  import { api } from "$lib/api/browser";
  import type { AppointmentStatus } from "$lib/api/enums";
  import { endpoints } from "$lib/api/registry";
  import type { completeAppointmentResponseSchema } from "$lib/api/schemas/appointments";
  import { diffDays } from "$lib/dates";
  import { formatWhen, spanOf } from "$lib/appointments/format";
  import { needsClosing } from "$lib/appointments/list";
  import AppointmentFormDialog from "$lib/components/appointments/appointment-form-dialog.svelte";
  import AppointmentStatusBadge from "$lib/components/appointments/appointment-status-badge.svelte";
  import ConfirmDialog from "$lib/components/app/confirm-dialog.svelte";
  import Attachments from "$lib/components/attachments/attachments.svelte";
  import Comments from "$lib/components/comments/comments.svelte";
  import * as Alert from "$lib/components/ui/alert/index.js";
  import { Button } from "$lib/components/ui/button/index.js";
  import * as Card from "$lib/components/ui/card/index.js";
  import * as DropdownMenu from "$lib/components/ui/dropdown-menu/index.js";
  import { apiErrorMessage } from "$lib/error-message";
  import { formatDateTime, formatRelativeDays } from "$lib/format";
  import { assetHref, contactHref, taskHref } from "$lib/links";
  import { gotoFromOverlay } from "$lib/overlays/use-overlay-history.svelte";
  import { m } from "$lib/paraglide/messages";
  import type { PageProps } from "./$types";

  type CompleteResult = z.output<typeof completeAppointmentResponseSchema>;

  let { data }: PageProps = $props();

  const appointment = $derived(data.appointment);
  const canWrite = $derived(data.scopes.includes("write"));
  const span = $derived(spanOf(appointment, data.timeZone));
  const open = $derived(needsClosing(appointment, data.today, data.timeZone));
  const relative = $derived(
    formatRelativeDays(
      span.last < data.today
        ? diffDays(span.last, data.today)
        : span.first > data.today
          ? diffDays(span.first, data.today)
          : 0,
    ),
  );
  const hasLinks = $derived(
    Boolean(appointment.taskId || appointment.assetId || appointment.contactId),
  );

  let editOpen = $state(false);
  let deleteOpen = $state(false);
  let busy = $state<"complete" | "status" | null>(null);
  let completed = $state.raw<(CompleteResult & { id: string }) | null>(null);
  /** What completing did, for this appointment only. */
  const result = $derived(
    completed && completed.id === appointment.id ? completed : null,
  );

  async function complete() {
    if (busy) return;
    busy = "complete";
    try {
      const done = await api.call(endpoints.appointmentsComplete, {
        params: { id: appointment.id },
        body: {},
      });
      completed = { ...done, id: appointment.id };
      if (done.replayed) toast.info(m.appointment_already_done_toast());
      else
        toast.success(
          m.appointment_done_toast({ title: done.appointment.title }),
        );
      await invalidateAll();
    } catch (err) {
      toast.error(
        apiErrorMessage(err, { conflict: m.appointment_complete_cancelled() }),
      );
    } finally {
      busy = null;
    }
  }

  async function setStatus(
    status: AppointmentStatus,
    done: string,
    undoTo?: AppointmentStatus,
  ) {
    if (busy) return;
    busy = "status";
    try {
      await api.call(endpoints.appointmentsUpdate, {
        params: { id: appointment.id },
        body: { status },
      });
      await invalidateAll();
      toast.success(
        done,
        undoTo
          ? {
              action: {
                label: m.common_undo(),
                onClick: () =>
                  void setStatus(
                    undoTo,
                    m.appointment_reopened_toast({ title: appointment.title }),
                  ),
              },
            }
          : {},
      );
    } catch (err) {
      toast.error(apiErrorMessage(err));
    } finally {
      busy = null;
    }
  }

  async function remove() {
    const { id, title } = appointment;
    await api.call(endpoints.appointmentsDelete, { params: { id } });
    toast.success(m.appointment_deleted_toast({ title }));
    await gotoFromOverlay(resolve("/appointments"), { invalidateAll: true });
  }

  const linkClass =
    "hover:bg-accent/50 focus-visible:ring-ring/50 -mx-2 flex min-h-11 items-center gap-3 rounded-md px-2 py-2 text-sm outline-none focus-visible:ring-[3px]";
</script>

<svelte:head>
  <title>{appointment.title} · {m.nav_appointments()} · {m.app_name()}</title>
</svelte:head>

<div class="flex flex-col gap-6">
  <div class="max-md:hidden">
    <a
      href={resolve("/appointments")}
      class="text-muted-foreground hover:text-foreground focus-visible:ring-ring/50 -ms-1 inline-flex min-h-10 items-center gap-1.5 rounded px-1 text-sm outline-none focus-visible:ring-[3px]"
    >
      <ArrowLeftIcon class="size-4" aria-hidden="true" />
      {m.nav_appointments()}
    </a>
  </div>

  <header class="flex flex-col gap-4">
    <div class="flex flex-col gap-2">
      <p
        class="text-muted-foreground flex flex-wrap items-center gap-x-2 gap-y-1 text-sm"
      >
        <CalendarClockIcon class="size-4" aria-hidden="true" />
        <span>{m.appointment_kind()}</span>
        {#if open}
          <span
            class="bg-warning/15 text-warning inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap"
            >{m.appointment_open_badge()}</span
          >
        {:else}
          <AppointmentStatusBadge status={appointment.status} />
        {/if}
      </p>
      <h1
        class="text-2xl font-semibold tracking-tight text-balance wrap-anywhere md:text-3xl"
      >
        {appointment.title}
      </h1>
      <p class="text-base font-medium wrap-anywhere tabular-nums">
        {formatWhen(appointment, {
          timeZone: data.timeZone,
          today: data.today,
        })}
        <span class="text-muted-foreground text-sm font-normal"
          >· {relative}</span
        >
      </p>
    </div>

    {#if canWrite}
      <div class="flex flex-col gap-2">
        <div class="flex items-center gap-2 sm:flex-wrap">
          {#if appointment.status === "planned"}
            <Button
              size="lg"
              class="max-sm:flex-1"
              disabled={busy !== null}
              onclick={complete}
            >
              {#if busy === "complete"}
                <LoaderCircleIcon class="animate-spin" />
              {:else}
                <CheckIcon />
              {/if}
              {m.appointment_complete()}
            </Button>
          {:else}
            <Button
              size="lg"
              variant="outline"
              class="max-sm:flex-1"
              disabled={busy !== null}
              onclick={() =>
                setStatus(
                  "planned",
                  m.appointment_reopened_toast({ title: appointment.title }),
                )}
            >
              {#if busy === "status"}
                <LoaderCircleIcon class="animate-spin" />
              {:else}
                <RotateCcwIcon />
              {/if}
              {m.appointment_reopen()}
            </Button>
          {/if}
          <Button
            size="lg"
            variant="outline"
            class="max-sm:hidden"
            onclick={() => (editOpen = true)}
          >
            <PencilIcon />{m.common_edit()}
          </Button>
          <DropdownMenu.Root>
            <DropdownMenu.Trigger>
              {#snippet child({ props })}
                <Button
                  {...props}
                  variant="outline"
                  size="icon-lg"
                  aria-label={m.appointment_actions()}
                >
                  <EllipsisVerticalIcon />
                </Button>
              {/snippet}
            </DropdownMenu.Trigger>
            <DropdownMenu.Content align="end" class="min-w-48">
              <DropdownMenu.Item
                class="min-h-10 sm:hidden"
                onSelect={() => (editOpen = true)}
              >
                <PencilIcon />{m.common_edit()}
              </DropdownMenu.Item>
              {#if appointment.status === "planned"}
                <DropdownMenu.Item
                  class="min-h-10"
                  disabled={busy !== null}
                  onSelect={() =>
                    setStatus(
                      "cancelled",
                      m.appointment_cancelled_toast({
                        title: appointment.title,
                      }),
                      "planned",
                    )}
                >
                  <CalendarXIcon />{m.appointment_cancel()}
                </DropdownMenu.Item>
              {/if}
              <DropdownMenu.Separator />
              <DropdownMenu.Item
                variant="destructive"
                class="min-h-10"
                onSelect={() => (deleteOpen = true)}
              >
                <Trash2Icon />{m.common_delete()}
              </DropdownMenu.Item>
            </DropdownMenu.Content>
          </DropdownMenu.Root>
        </div>
        {#if appointment.status === "planned" && appointment.taskTitle}
          <p class="text-muted-foreground text-xs text-pretty">
            {m.appointment_complete_task_hint({ task: appointment.taskTitle })}
          </p>
        {/if}
      </div>
    {/if}
  </header>

  {#if result?.task}
    <Alert.Root role="status" class="border-success/40">
      {#if result.completion}
        <CheckIcon />
        <Alert.Title>
          {m.appointment_result_task_done({ title: result.task.title })}
        </Alert.Title>
        <Alert.Description class="flex flex-col items-start gap-3">
          <p class="text-pretty">{m.appointment_result_task_done_hint()}</p>
          <Button href={taskHref(result.task.id)} variant="outline" size="lg">
            {m.appointment_result_open_task()}
          </Button>
        </Alert.Description>
      {:else}
        <InfoIcon />
        <Alert.Title>
          {m.appointment_result_task_kept({ title: result.task.title })}
        </Alert.Title>
        <Alert.Description class="flex flex-col items-start gap-3">
          <p class="text-pretty">
            {result.task.archivedAt
              ? m.appointment_result_task_archived()
              : m.appointment_result_task_settled()}
          </p>
          <Button href={taskHref(result.task.id)} variant="outline" size="lg">
            {m.appointment_result_open_task()}
          </Button>
        </Alert.Description>
      {/if}
    </Alert.Root>
  {/if}

  <div
    class="grid grid-cols-1 items-start gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]"
  >
    <Card.Root class="min-w-0 lg:col-start-1">
      <Card.Header>
        <Card.Title class="text-base">{m.appointment_details()}</Card.Title>
      </Card.Header>
      <Card.Content>
        <dl class="grid gap-4 text-sm">
          <div class="min-w-0">
            <dt class="text-muted-foreground text-xs">
              {m.appointment_location_label()}
            </dt>
            <dd class="mt-0.5 flex items-start gap-1.5 wrap-anywhere">
              {#if appointment.location}
                <MapPinIcon
                  class="text-muted-foreground mt-0.5 size-4 shrink-0"
                  aria-hidden="true"
                />
                <span class="min-w-0">{appointment.location}</span>
              {:else}
                <span class="text-muted-foreground">–</span>
              {/if}
            </dd>
          </div>
          <div class="min-w-0">
            <dt class="text-muted-foreground text-xs">
              {m.appointment_notes_label()}
            </dt>
            <dd class="mt-0.5 wrap-anywhere whitespace-pre-line">
              {#if appointment.notes}
                {appointment.notes}
              {:else}
                <span class="text-muted-foreground">–</span>
              {/if}
            </dd>
          </div>
        </dl>
      </Card.Content>
    </Card.Root>

    <Card.Root class="min-w-0 lg:col-start-2 lg:row-span-3 lg:row-start-1">
      <Card.Header>
        <Card.Title class="text-base">{m.appointment_links()}</Card.Title>
      </Card.Header>
      <Card.Content class="flex flex-col gap-4">
        {#if hasLinks}
          <ul class="flex flex-col divide-y">
            {#if appointment.taskId && appointment.taskTitle}
              <li>
                <a href={taskHref(appointment.taskId)} class={linkClass}>
                  <ListChecksIcon
                    class="text-muted-foreground size-4 shrink-0"
                    aria-hidden="true"
                  />
                  <span class="min-w-0">
                    <span class="text-muted-foreground block text-xs"
                      >{m.appointment_task_label()}</span
                    >
                    <span class="font-medium wrap-anywhere"
                      >{appointment.taskTitle}</span
                    >
                  </span>
                </a>
              </li>
            {/if}
            {#if appointment.assetId && appointment.assetName}
              <li>
                <a href={assetHref(appointment.assetId)} class={linkClass}>
                  <BoxesIcon
                    class="text-muted-foreground size-4 shrink-0"
                    aria-hidden="true"
                  />
                  <span class="min-w-0">
                    <span class="text-muted-foreground block text-xs"
                      >{m.appointment_asset_label()}</span
                    >
                    <span class="font-medium wrap-anywhere"
                      >{appointment.assetName}</span
                    >
                  </span>
                </a>
              </li>
            {/if}
            {#if appointment.contactId && appointment.contactName}
              <li>
                <a href={contactHref(appointment.contactId)} class={linkClass}>
                  <ContactIcon
                    class="text-muted-foreground size-4 shrink-0"
                    aria-hidden="true"
                  />
                  <span class="min-w-0">
                    <span class="text-muted-foreground block text-xs"
                      >{m.appointment_contact_label()}</span
                    >
                    <span class="font-medium wrap-anywhere"
                      >{appointment.contactName}</span
                    >
                  </span>
                </a>
              </li>
            {/if}
          </ul>
        {:else}
          <p class="text-muted-foreground text-sm text-pretty">
            {m.appointment_links_none()}
          </p>
        {/if}
        <p class="text-muted-foreground border-t pt-4 text-xs">
          {m.appointment_meta_created({
            when: formatDateTime(appointment.createdAt, {
              timeZone: data.timeZone,
            }),
          })}
          {#if appointment.updatedAt !== appointment.createdAt}
            <br />
            {m.appointment_meta_updated({
              when: formatDateTime(appointment.updatedAt, {
                timeZone: data.timeZone,
              }),
            })}
          {/if}
        </p>
      </Card.Content>
    </Card.Root>

    <div class="min-w-0 lg:col-start-1">
      <Attachments
        ownerType="appointment"
        ownerId={appointment.id}
        editable={canWrite}
        title={m.appointment_files_title()}
        description={m.appointment_files_description()}
      />
    </div>

    <div class="min-w-0 lg:col-start-1">
      <Comments
        entityType="appointment"
        entityId={appointment.id}
        timeZone={data.timeZone}
      />
    </div>
  </div>
</div>

{#if canWrite}
  <AppointmentFormDialog
    bind:open={editOpen}
    {appointment}
    timeZone={data.timeZone}
    today={data.today}
    onsaved={() => invalidateAll()}
  />
{/if}

<ConfirmDialog
  bind:open={deleteOpen}
  title={m.appointment_delete_title()}
  description={m.appointment_delete_description({ title: appointment.title })}
  confirmLabel={m.common_delete()}
  pendingLabel={m.common_deleting()}
  destructive
  onconfirm={remove}
/>
