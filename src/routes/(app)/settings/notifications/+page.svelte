<script lang="ts">
  import { invalidateAll } from "$app/navigation";
  import { page } from "$app/state";
  import { resolve } from "$app/paths";
  import BellIcon from "@lucide/svelte/icons/bell";
  import BellOffIcon from "@lucide/svelte/icons/bell-off";
  import LoaderCircleIcon from "@lucide/svelte/icons/loader-circle";
  import PlusIcon from "@lucide/svelte/icons/plus";
  import SmartphoneIcon from "@lucide/svelte/icons/smartphone";
  import TriangleAlertIcon from "@lucide/svelte/icons/triangle-alert";
  import { toast } from "svelte-sonner";
  import { api } from "$lib/api/browser";
  import { PUSH_STAGES, type PushStage } from "$lib/api/enums";
  import { endpoints } from "$lib/api/registry";
  import {
    MAX_NOTIFICATION_TARGETS,
    NOTIFY_TARGET_PATTERN,
  } from "$lib/api/schemas/notification-settings";
  import CopyButton from "$lib/components/app/copy-button.svelte";
  import FormAlert from "$lib/components/app/form-alert.svelte";
  import SwitchField from "$lib/components/app/switch-field.svelte";
  import Field from "$lib/components/tasks/field.svelte";
  import * as Alert from "$lib/components/ui/alert/index.js";
  import { Button } from "$lib/components/ui/button/index.js";
  import * as Card from "$lib/components/ui/card/index.js";
  import { Checkbox } from "$lib/components/ui/checkbox/index.js";
  import { Input } from "$lib/components/ui/input/index.js";
  import { Label } from "$lib/components/ui/label/index.js";
  import { apiErrorMessage } from "$lib/error-message";
  import { haActionPackage } from "$lib/connections/ha-package";
  import { m } from "$lib/paraglide/messages";
  import type { PageProps } from "./$types";

  let { data }: PageProps = $props();

  const DEFAULT_QUIET = { start: "22:00", end: "07:00" };

  const stageLabels: Record<
    PushStage,
    { label: () => string; hint: () => string }
  > = {
    prep: {
      label: () => m.push_stage_prep(),
      hint: () => m.push_stage_prep_hint(),
    },
    due_soon: {
      label: () => m.push_stage_due_soon(),
      hint: () => m.push_stage_due_soon_hint(),
    },
    due: {
      label: () => m.push_stage_due(),
      hint: () => m.push_stage_due_hint(),
    },
    overdue: {
      label: () => m.push_stage_overdue(),
      hint: () => m.push_stage_overdue_hint(),
    },
    hint: {
      label: () => m.push_stage_hint(),
      hint: () => m.push_stage_hint_hint(),
    },
    comment: {
      label: () => m.push_stage_comment(),
      hint: () => m.push_stage_comment_hint(),
    },
    digest: {
      label: () => m.push_stage_digest(),
      hint: () => m.push_stage_digest_hint(),
    },
  };

  type TargetRow = { target: string; enabled: boolean; saved: boolean };

  function rowsFrom(settings: typeof data.settings): TargetRow[] {
    return settings.targets.map((t) => ({
      target: t.target,
      enabled: t.enabled,
      saved: true,
    }));
  }

  /* The form is seeded once; saving reloads the page data and the baseline below. */
  /* svelte-ignore state_referenced_locally */
  let pushEnabled = $state(data.settings.pushEnabled);
  /* svelte-ignore state_referenced_locally */
  let quietOn = $state(data.settings.quietStart !== null);
  /* svelte-ignore state_referenced_locally */
  let quietStart = $state(data.settings.quietStart ?? DEFAULT_QUIET.start);
  /* svelte-ignore state_referenced_locally */
  let quietEnd = $state(data.settings.quietEnd ?? DEFAULT_QUIET.end);
  /* svelte-ignore state_referenced_locally */
  let stages = $state<PushStage[]>([...data.settings.pushStages]);
  /* svelte-ignore state_referenced_locally */
  let rows = $state<TargetRow[]>(rowsFrom(data.settings));
  let manual = $state("");
  let manualError = $state<string | undefined>();
  let pending = $state(false);
  let error = $state<string | undefined>();

  const known = $derived(new Set(data.services));
  const candidates = $derived.by(() => {
    const names = new Set([...data.services, ...rows.map((r) => r.target)]);
    return [...names].sort((a, b) => {
      const phoneA = a.startsWith("mobile_app_") ? 0 : 1;
      const phoneB = b.startsWith("mobile_app_") ? 0 : 1;
      return phoneA - phoneB || a.localeCompare(b);
    });
  });
  const enabledTargets = $derived(
    rows.filter((r) => r.enabled).map((r) => r.target),
  );

  const baselineKey = $derived(
    JSON.stringify([
      data.settings.pushEnabled,
      data.settings.quietStart,
      data.settings.quietEnd,
      [...data.settings.pushStages].sort(),
      data.settings.targets.map((t) => [t.target, t.enabled]),
    ]),
  );
  const currentKey = $derived(
    JSON.stringify([
      pushEnabled,
      quietOn ? quietStart : null,
      quietOn ? quietEnd : null,
      [...stages].sort(),
      rows.map((r) => [r.target, r.enabled]),
    ]),
  );
  const dirty = $derived(baselineKey !== currentKey);

  function prettyName(target: string): string {
    const base = target.startsWith("mobile_app_")
      ? target.slice("mobile_app_".length)
      : target;
    return base
      .split("_")
      .filter(Boolean)
      .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
      .join(" ");
  }

  function isOn(target: string): boolean {
    return rows.find((r) => r.target === target)?.enabled ?? false;
  }

  function toggleTarget(target: string, on: boolean) {
    const row = rows.find((r) => r.target === target);
    if (row) {
      row.enabled = on;
      if (!on && !row.saved) rows = rows.filter((r) => r !== row);
      return;
    }
    if (on) rows = [...rows, { target, enabled: true, saved: false }];
  }

  function toggleStage(stage: PushStage, on: boolean) {
    stages = on
      ? [...stages.filter((s) => s !== stage), stage]
      : stages.filter((s) => s !== stage);
  }

  function addManual() {
    const name = manual.trim();
    manualError = undefined;
    if (name === "") return;
    if (!NOTIFY_TARGET_PATTERN.test(name)) {
      manualError = m.notify_manual_invalid();
      return;
    }
    if (rows.some((r) => r.target === name && r.enabled)) {
      manualError = m.notify_manual_duplicate();
      return;
    }
    if (rows.length >= MAX_NOTIFICATION_TARGETS && !isOn(name)) {
      manualError = m.notify_targets_max({ max: MAX_NOTIFICATION_TARGETS });
      return;
    }
    toggleTarget(name, true);
    manual = "";
  }

  async function submit(event: SubmitEvent) {
    event.preventDefault();
    if (!dirty || pending) return;
    error = undefined;
    if (rows.length > MAX_NOTIFICATION_TARGETS) {
      error = m.notify_targets_max({ max: MAX_NOTIFICATION_TARGETS });
      return;
    }
    if (quietOn && (!quietStart || !quietEnd)) {
      error = m.notify_quiet_incomplete();
      return;
    }
    pending = true;
    try {
      const saved = await api.call(endpoints.notificationSettingsPut, {
        body: {
          pushEnabled,
          quietStart: quietOn ? quietStart : null,
          quietEnd: quietOn ? quietEnd : null,
          pushStages: stages,
          targets: rows.map((r) => ({
            channel: "ha_notify" as const,
            target: r.target,
            enabled: r.enabled,
          })),
        },
      });
      rows = rowsFrom(saved);
      await invalidateAll();
      toast.success(m.notify_saved());
    } catch (err) {
      error = apiErrorMessage(err);
    } finally {
      pending = false;
    }
  }

  const packageYaml = $derived(haActionPackage(page.url.origin));
</script>

<svelte:head>
  <title>{m.notify_title()} · {m.settings_title()} · {m.app_name()}</title>
</svelte:head>

<div class="flex max-w-2xl flex-col gap-6">
  <form class="contents" onsubmit={submit} novalidate>
    <Card.Root>
      <Card.Header>
        <Card.Title>{m.notify_title()}</Card.Title>
        <Card.Description class="text-pretty">
          {m.notify_description()}
        </Card.Description>
      </Card.Header>
      <Card.Content class="flex flex-col gap-6">
        <FormAlert message={error} />

        <SwitchField
          id="push-enabled"
          bind:checked={pushEnabled}
          label={m.notify_push_enabled()}
          hint={m.notify_push_enabled_hint()}
        />

        <section class="flex flex-col gap-3" aria-labelledby="notify-targets">
          <div class="flex flex-col gap-1">
            <h3 id="notify-targets" class="text-sm font-medium">
              {m.notify_targets_title()}
            </h3>
            <p class="text-muted-foreground text-xs text-pretty">
              {m.notify_targets_hint()}
            </p>
          </div>

          {#if !data.connected}
            <Alert.Root>
              <BellOffIcon />
              <Alert.Title>{m.notify_not_connected_title()}</Alert.Title>
              <Alert.Description class="text-pretty">
                {m.notify_not_connected_body()}
                <a
                  href={resolve("/settings/integrations")}
                  class="text-foreground mt-1 inline-block font-medium underline underline-offset-2"
                >
                  {m.notify_not_connected_link()}
                </a>
              </Alert.Description>
            </Alert.Root>
          {:else if data.servicesError}
            <Alert.Root variant="destructive" class="border-destructive/40">
              <TriangleAlertIcon />
              <Alert.Description class="text-pretty">
                {data.servicesError}
                {m.notify_services_failed()}
              </Alert.Description>
            </Alert.Root>
          {/if}

          {#if candidates.length > 0}
            <ul
              class="divide-y rounded-lg border"
              aria-label={m.notify_targets_title()}
            >
              {#each candidates as target (target)}
                {@const missing =
                  data.connected && !data.servicesError && !known.has(target)}
                <li>
                  <label
                    class="hover:bg-accent/40 flex min-h-14 cursor-pointer items-center gap-3 px-3 py-2 transition-colors"
                  >
                    <Checkbox
                      checked={isOn(target)}
                      onCheckedChange={(on) => toggleTarget(target, on)}
                      aria-label={prettyName(target)}
                    />
                    <span
                      class="bg-muted text-muted-foreground flex size-8 shrink-0 items-center justify-center rounded-md"
                      aria-hidden="true"
                    >
                      {#if target.startsWith("mobile_app_")}
                        <SmartphoneIcon class="size-4" />
                      {:else}
                        <BellIcon class="size-4" />
                      {/if}
                    </span>
                    <span class="flex min-w-0 flex-1 flex-col">
                      <span class="truncate text-sm font-medium"
                        >{prettyName(target)}</span
                      >
                      <span
                        class="text-muted-foreground truncate font-mono text-xs"
                        >notify.{target}</span
                      >
                    </span>
                    {#if missing}
                      <span class="text-warning shrink-0 text-xs"
                        >{m.notify_target_missing()}</span
                      >
                    {/if}
                  </label>
                </li>
              {/each}
            </ul>
          {:else if data.connected && !data.servicesError}
            <p
              class="text-muted-foreground rounded-lg border border-dashed px-3 py-6 text-center text-sm text-pretty"
            >
              {m.notify_services_empty()}
            </p>
          {/if}

          <details class="rounded-lg border px-3 py-2 text-sm">
            <summary
              class="focus-visible:ring-ring/50 min-h-8 cursor-pointer rounded font-medium outline-none select-none focus-visible:ring-[3px]"
            >
              {m.notify_manual_title()}
            </summary>
            <div class="mt-3 flex flex-col gap-2 pb-1">
              <Field
                id="notify-manual"
                label={m.notify_manual_label()}
                hint={m.notify_manual_hint()}
                error={manualError}
              >
                {#snippet children({ describedby, invalid })}
                  <div class="flex gap-2">
                    <Input
                      id="notify-manual"
                      class="h-10 font-mono"
                      autocomplete="off"
                      autocapitalize="none"
                      spellcheck={false}
                      maxlength={100}
                      placeholder="mobile_app_example_phone"
                      bind:value={manual}
                      aria-invalid={invalid || undefined}
                      aria-describedby={describedby}
                      onkeydown={(event) => {
                        if (event.key === "Enter") {
                          event.preventDefault();
                          addManual();
                        }
                      }}
                    />
                    <Button
                      type="button"
                      variant="outline"
                      class="h-10 shrink-0"
                      onclick={addManual}
                    >
                      <PlusIcon />{m.common_add()}
                    </Button>
                  </div>
                {/snippet}
              </Field>
            </div>
          </details>

          {#if pushEnabled && enabledTargets.length === 0}
            <p class="text-warning text-xs text-pretty">
              {m.notify_no_target()}
            </p>
          {/if}
        </section>

        <section class="flex flex-col gap-3" aria-labelledby="notify-stages">
          <div class="flex flex-col gap-1">
            <h3 id="notify-stages" class="text-sm font-medium">
              {m.notify_stages_title()}
            </h3>
            <p class="text-muted-foreground text-xs text-pretty">
              {m.notify_stages_hint()}
            </p>
          </div>
          <ul class="divide-y rounded-lg border">
            {#each PUSH_STAGES as stage (stage)}
              <li>
                <label
                  class="hover:bg-accent/40 flex min-h-12 cursor-pointer items-start gap-3 px-3 py-2.5 transition-colors"
                >
                  <Checkbox
                    class="mt-0.5"
                    checked={stages.includes(stage)}
                    onCheckedChange={(on) => toggleStage(stage, on)}
                    aria-label={stageLabels[stage].label()}
                  />
                  <span class="flex min-w-0 flex-col">
                    <span class="text-sm font-medium"
                      >{stageLabels[stage].label()}</span
                    >
                    <span class="text-muted-foreground text-xs text-pretty"
                      >{stageLabels[stage].hint()}</span
                    >
                  </span>
                </label>
              </li>
            {/each}
          </ul>
        </section>

        <section class="flex flex-col gap-3" aria-labelledby="notify-quiet">
          <h3 id="notify-quiet" class="sr-only">{m.notify_quiet_title()}</h3>
          <SwitchField
            id="quiet-on"
            bind:checked={quietOn}
            label={m.notify_quiet_title()}
            hint={m.notify_quiet_hint({ zone: data.timeZone })}
          />
          {#if quietOn}
            <div class="grid grid-cols-2 gap-4 ps-11">
              <div class="flex flex-col gap-2">
                <Label for="quiet-start">{m.notify_quiet_start()}</Label>
                <Input
                  id="quiet-start"
                  type="time"
                  class="h-10"
                  required
                  bind:value={quietStart}
                />
              </div>
              <div class="flex flex-col gap-2">
                <Label for="quiet-end">{m.notify_quiet_end()}</Label>
                <Input
                  id="quiet-end"
                  type="time"
                  class="h-10"
                  required
                  bind:value={quietEnd}
                />
              </div>
            </div>
          {/if}
        </section>

        <div>
          <Button type="submit" disabled={!dirty || pending}>
            {#if pending}
              <LoaderCircleIcon class="animate-spin" />{m.common_saving()}
            {:else}
              {m.common_save()}
            {/if}
          </Button>
        </div>
      </Card.Content>
    </Card.Root>
  </form>

  <Card.Root>
    <Card.Header>
      <Card.Title>{m.notify_done_title()}</Card.Title>
      <Card.Description class="text-pretty">
        {m.notify_done_description()}
      </Card.Description>
    </Card.Header>
    <Card.Content class="flex flex-col gap-4 text-sm">
      <ol
        class="text-muted-foreground flex list-decimal flex-col gap-1.5 ps-5 text-pretty"
      >
        <li>{m.notify_done_step1()}</li>
        <li>
          {m.notify_done_step2()}
          <a
            href={resolve("/settings/tokens")}
            class="text-foreground underline underline-offset-2"
          >
            {m.notify_done_step2_link()}
          </a>
        </li>
        <li>{m.notify_done_step3()}</li>
      </ol>
      <details class="rounded-lg border px-3 py-2">
        <summary
          class="focus-visible:ring-ring/50 min-h-8 cursor-pointer rounded font-medium outline-none select-none focus-visible:ring-[3px]"
        >
          {m.notify_done_package()}
        </summary>
        <div class="mt-3 flex flex-col gap-3 pb-1">
          <p class="text-muted-foreground text-xs text-pretty">
            {m.notify_done_package_hint()}
          </p>
          <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
          <pre
            class="bg-muted max-h-72 overflow-auto rounded-md p-3 font-mono text-xs leading-relaxed"
            tabindex="0"
            aria-label={m.notify_done_package()}><code>{packageYaml}</code
            ></pre>
          <div>
            <CopyButton value={packageYaml} label={m.notify_done_copy()} />
          </div>
        </div>
      </details>
    </Card.Content>
  </Card.Root>
</div>
