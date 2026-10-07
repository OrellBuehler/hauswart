<script lang="ts">
  import { resolve } from "$app/paths";
  import LoaderCircleIcon from "@lucide/svelte/icons/loader-circle";
  import LockKeyholeIcon from "@lucide/svelte/icons/lock-keyhole";
  import ShieldCheckIcon from "@lucide/svelte/icons/shield-check";
  import TriangleAlertIcon from "@lucide/svelte/icons/triangle-alert";
  import UnplugIcon from "@lucide/svelte/icons/unplug";
  import { toast } from "svelte-sonner";
  import { api } from "$lib/api/browser";
  import { endpoints } from "$lib/api/registry";
  import type { z } from "zod";
  import type { testIntegrationResponseSchema } from "$lib/api/schemas/integrations";
  import ConfirmDialog from "$lib/components/app/confirm-dialog.svelte";
  import FormAlert from "$lib/components/app/form-alert.svelte";
  import SwitchField from "$lib/components/app/switch-field.svelte";
  import Field from "$lib/components/tasks/field.svelte";
  import * as Alert from "$lib/components/ui/alert/index.js";
  import { Button } from "$lib/components/ui/button/index.js";
  import * as Card from "$lib/components/ui/card/index.js";
  import { Input } from "$lib/components/ui/input/index.js";
  import { Separator } from "$lib/components/ui/separator/index.js";
  import { apiErrorMessage } from "$lib/error-message";
  import { forgetIntegrations } from "$lib/connections/connection";
  import {
    keptErrorMessage,
    keptSaveError,
    keptSettingsSignature,
    readKeptSettings,
    type KeptSettings,
  } from "$lib/connections/kept";
  import { formatDateTime, formatRelativeInstant } from "$lib/format";
  import { m } from "$lib/paraglide/messages";
  import { cn } from "$lib/utils";
  import type { IntegrationCardProps } from "./cards";
  import KeptSettingsForm from "./kept-settings.svelte";
  import KeptSync from "./kept-sync.svelte";
  import KeptTestResult from "./kept-test-result.svelte";
  import { kindMeta } from "./kinds";
  import StatusBadge from "./status-badge.svelte";

  type TestResult = z.infer<typeof testIntegrationResponseSchema>;

  let { integration, canEdit, timeZone, onchanged }: IntegrationCardProps =
    $props();

  const meta = kindMeta.kept;
  const KIND = "kept" as const;
  const TOKEN_PATTERN = /^[\x21-\x7e]{1,4096}$/;

  /* The forms are seeded once; saving reloads the list and the baselines below. */
  /* svelte-ignore state_referenced_locally */
  let baseUrl = $state(integration.baseUrl ?? "");
  let token = $state("");
  /* svelte-ignore state_referenced_locally */
  let replaceToken = $state(!integration.configured);
  /* svelte-ignore state_referenced_locally */
  let allowInsecureTls = $state(integration.allowInsecureTls);
  /* svelte-ignore state_referenced_locally */
  let enabled = $state(integration.configured ? integration.enabled : true);
  /* svelte-ignore state_referenced_locally */
  let settings = $state<KeptSettings>(readKeptSettings(integration.config));

  let saving = $state(false);
  let testing = $state(false);
  let error = $state<string | undefined>();
  let fieldErrors = $state<Record<string, string>>({});
  let testResult = $state<TestResult | undefined>();
  let disconnectOpen = $state(false);
  /** Bumped when the connection changed, so the category list is read again. */
  let refreshKey = $state(0);

  const urlChanged = $derived(
    integration.configured && baseUrl.trim() !== (integration.baseUrl ?? ""),
  );
  const showTokenInput = $derived(
    !integration.configured || replaceToken || urlChanged,
  );
  const dirty = $derived(
    baseUrl.trim() !== (integration.baseUrl ?? "") ||
      token.trim() !== "" ||
      allowInsecureTls !== integration.allowInsecureTls ||
      enabled !== (integration.configured ? integration.enabled : true),
  );
  const settingsDirty = $derived(
    keptSettingsSignature(settings) !==
      keptSettingsSignature(readKeptSettings(integration.config)),
  );

  function when(iso: string): { relative: string; absolute: string } {
    return {
      relative: formatRelativeInstant(iso),
      absolute: formatDateTime(iso, { timeZone }),
    };
  }

  function validate(): boolean {
    const found: Record<string, string> = {};
    if (baseUrl.trim() === "") found.baseUrl = m.field_required();
    else if (!/^https?:\/\//i.test(baseUrl.trim()))
      found.baseUrl = m.integration_ha_url_invalid();
    if (showTokenInput && token.trim() === "") {
      found.token = urlChanged
        ? m.integration_ha_token_required_url()
        : m.field_required();
    } else if (token.trim() !== "" && !TOKEN_PATTERN.test(token.trim())) {
      found.token = m.integration_kept_token_invalid();
    }
    fieldErrors = found;
    return Object.keys(found).length === 0;
  }

  async function runTest(): Promise<void> {
    testing = true;
    testResult = undefined;
    try {
      testResult = await api.call(endpoints.integrationsTest, {
        params: { kind: KIND },
      });
      forgetIntegrations();
      await onchanged();
    } catch (err) {
      error = apiErrorMessage(err);
    } finally {
      testing = false;
      refreshKey += 1;
    }
  }

  async function submit(event: SubmitEvent) {
    event.preventDefault();
    if (!canEdit || saving || testing) return;
    error = undefined;
    if (!validate()) return;
    saving = true;
    try {
      const saved = await api.call(endpoints.integrationsSave, {
        params: { kind: KIND },
        body: {
          baseUrl: baseUrl.trim(),
          ...(token.trim() !== "" ? { token: token.trim() } : {}),
          allowInsecureTls,
          enabled,
        },
      });
      baseUrl = saved.baseUrl ?? baseUrl;
      token = "";
      replaceToken = false;
      forgetIntegrations();
      toast.success(m.integration_saved());
    } catch (err) {
      const failure = keptSaveError(err, baseUrl);
      error = failure.message;
      fieldErrors = failure.fields;
      saving = false;
      return;
    }
    saving = false;
    await onchanged();
    if (enabled) await runTest();
    else refreshKey += 1;
  }

  async function disconnect() {
    await api.call(endpoints.integrationsDelete, { params: { kind: KIND } });
    forgetIntegrations();
    baseUrl = "";
    token = "";
    allowInsecureTls = false;
    enabled = true;
    replaceToken = true;
    settings = readKeptSettings({});
    testResult = undefined;
    error = undefined;
    fieldErrors = {};
    toast.success(m.integration_kept_disconnected());
    await onchanged();
  }
</script>

<Card.Root>
  <Card.Header>
    <div class="flex flex-wrap items-start justify-between gap-x-3 gap-y-2">
      <div class="flex min-w-0 items-center gap-3">
        <span
          class="bg-brand/10 text-brand flex size-10 shrink-0 items-center justify-center rounded-lg"
          aria-hidden="true"
        >
          <meta.icon class="size-5" />
        </span>
        <Card.Title class="min-w-0 text-base">{meta.name()}</Card.Title>
      </div>
      <StatusBadge {integration} />
    </div>
    <Card.Description class="text-pretty">
      {meta.description()}
    </Card.Description>
  </Card.Header>

  <Card.Content class="flex flex-col gap-5">
    {#if integration.configured}
      {#if integration.enabled && integration.status === "error"}
        <Alert.Root variant="destructive" class="border-destructive/40">
          <TriangleAlertIcon />
          <Alert.Title>{m.integration_error_title()}</Alert.Title>
          <Alert.Description class="text-pretty">
            {keptErrorMessage(integration.lastError)}
            {#if integration.consecutiveFailures > 0}
              <span class="mt-1 block text-xs opacity-90">
                {m.integration_failures({
                  count: integration.consecutiveFailures,
                })}
              </span>
            {/if}
          </Alert.Description>
        </Alert.Root>
      {/if}
      <dl
        class="grid grid-cols-[auto_1fr] items-baseline gap-x-6 gap-y-2 text-sm"
      >
        <dt class="text-muted-foreground">{m.integration_last_ok()}</dt>
        <dd class="min-w-0 font-medium">
          {#if integration.lastOkAt}
            {@const t = when(integration.lastOkAt)}
            <time datetime={integration.lastOkAt} title={t.absolute}
              >{t.relative}</time
            >
          {:else}
            <span class="text-muted-foreground font-normal"
              >{m.integration_never()}</span
            >
          {/if}
        </dd>
        <dt class="text-muted-foreground">{m.integration_last_checked()}</dt>
        <dd class="min-w-0 font-medium">
          {#if integration.lastCheckedAt}
            {@const t = when(integration.lastCheckedAt)}
            <time datetime={integration.lastCheckedAt} title={t.absolute}
              >{t.relative}</time
            >
          {:else}
            <span class="text-muted-foreground font-normal"
              >{m.integration_never()}</span
            >
          {/if}
        </dd>
        {#if integration.consecutiveFailures > 0 && integration.status !== "error"}
          <dt class="text-muted-foreground">
            {m.integration_failures_label()}
          </dt>
          <dd class="font-medium tabular-nums">
            {integration.consecutiveFailures}
          </dd>
        {/if}
        {#if integration.baseUrl}
          <dt class="text-muted-foreground">{m.integration_kept_url()}</dt>
          <dd class="min-w-0 font-mono text-xs break-all">
            {integration.baseUrl}
          </dd>
        {/if}
      </dl>
    {:else}
      <p class="text-muted-foreground text-sm text-pretty">
        {m.integration_kept_intro()}
      </p>
    {/if}

    {#if testResult}
      <KeptTestResult result={testResult} />
    {/if}

    {#if canEdit}
      <form
        class={cn(
          "flex flex-col gap-5",
          integration.configured && "border-t pt-5",
        )}
        onsubmit={submit}
        novalidate
      >
        <FormAlert message={error} />

        <Field
          id="kept-url"
          label={m.integration_kept_url()}
          hint={m.integration_kept_url_hint()}
          error={fieldErrors.baseUrl}
        >
          {#snippet children({ describedby, invalid })}
            <Input
              id="kept-url"
              type="url"
              inputmode="url"
              class="h-10"
              autocomplete="off"
              autocapitalize="none"
              spellcheck={false}
              placeholder="https://kept.example.org"
              bind:value={baseUrl}
              aria-invalid={invalid || undefined}
              aria-describedby={describedby}
            />
          {/snippet}
        </Field>

        {#if showTokenInput}
          <Field
            id="kept-token"
            label={m.integration_kept_token()}
            hint={urlChanged
              ? m.integration_ha_token_hint_url()
              : m.integration_kept_token_hint()}
            error={fieldErrors.token}
          >
            {#snippet children({ describedby, invalid })}
              <Input
                id="kept-token"
                type="password"
                class="h-10 font-mono"
                autocomplete="new-password"
                autocapitalize="none"
                spellcheck={false}
                maxlength={4096}
                placeholder={m.integration_ha_token_placeholder()}
                bind:value={token}
                aria-invalid={invalid || undefined}
                aria-describedby={describedby}
              />
            {/snippet}
          </Field>
        {:else}
          <div class="flex flex-col gap-2">
            <span class="text-sm leading-none font-medium"
              >{m.integration_kept_token()}</span
            >
            <div
              class="bg-muted/50 flex items-center justify-between gap-3 rounded-md border px-3 py-2"
            >
              <span class="flex min-w-0 items-center gap-2 text-sm">
                <ShieldCheckIcon
                  class="text-success size-4 shrink-0"
                  aria-hidden="true"
                />
                <span class="font-medium"
                  >{m.integration_ha_token_stored()}</span
                >
                <span class="text-muted-foreground hidden text-xs sm:inline"
                  >{m.integration_ha_token_stored_hint()}</span
                >
              </span>
              <Button
                type="button"
                variant="outline"
                size="sm"
                class="h-9 shrink-0"
                onclick={() => (replaceToken = true)}
              >
                {m.integration_ha_token_replace()}
              </Button>
            </div>
          </div>
        {/if}

        <div class="flex flex-col gap-3">
          <SwitchField
            id="kept-insecure"
            bind:checked={allowInsecureTls}
            label={m.integration_kept_insecure()}
            hint={m.integration_kept_insecure_hint()}
          />
          {#if allowInsecureTls}
            <Alert.Root class="border-warning/50">
              <LockKeyholeIcon class="text-warning" />
              <Alert.Description class="text-pretty">
                {m.integration_kept_insecure_warning()}
              </Alert.Description>
            </Alert.Root>
          {/if}
        </div>

        {#if integration.configured}
          <SwitchField
            id="kept-enabled"
            bind:checked={enabled}
            label={m.integration_kept_enabled()}
            hint={m.integration_kept_enabled_hint()}
          />
        {/if}

        <div class="flex flex-wrap items-center gap-2">
          <Button type="submit" disabled={saving || testing || !dirty}>
            {#if saving}
              <LoaderCircleIcon class="animate-spin" />{m.common_saving()}
            {:else if integration.configured}
              {m.common_save()}
            {:else}
              {m.integration_connect()}
            {/if}
          </Button>
          {#if integration.configured}
            <Button
              type="button"
              variant="outline"
              disabled={saving || testing || dirty}
              onclick={runTest}
            >
              {#if testing}
                <LoaderCircleIcon
                  class="animate-spin"
                />{m.integration_testing()}
              {:else}
                {m.integration_test()}
              {/if}
            </Button>
            <Button
              type="button"
              variant="ghost"
              class="text-destructive hover:text-destructive ms-auto"
              disabled={saving || testing}
              onclick={() => (disconnectOpen = true)}
            >
              <UnplugIcon />{m.integration_disconnect()}
            </Button>
          {/if}
        </div>
        {#if integration.configured && dirty}
          <p class="text-muted-foreground -mt-3 text-xs">
            {m.integration_test_save_first()}
          </p>
        {/if}
      </form>

      {#if integration.configured}
        <Separator />
        <KeptSettingsForm
          {integration}
          bind:settings
          dirty={settingsDirty}
          {refreshKey}
          {onchanged}
        />
        <Separator />
        <KeptSync
          {integration}
          unsaved={settingsDirty}
          busy={saving || testing}
          {onchanged}
        />
      {/if}

      <details
        class="group rounded-lg border px-4 py-3 text-sm"
        open={!integration.configured}
      >
        <summary
          class="focus-visible:ring-ring/50 min-h-8 cursor-pointer rounded font-medium outline-none select-none focus-visible:ring-[3px]"
        >
          {m.integration_kept_help_title()}
        </summary>
        <div class="text-muted-foreground mt-3 flex flex-col gap-3 text-pretty">
          <ol class="flex list-decimal flex-col gap-1.5 ps-5">
            <li>{m.integration_kept_help_step1()}</li>
            <li>{m.integration_kept_help_step2()}</li>
            <li>{m.integration_kept_help_step3()}</li>
            <li>{m.integration_kept_help_step4()}</li>
          </ol>
          <p>
            {m.integration_kept_help_hosts()}
            <a
              href={resolve("/settings/household")}
              class="text-foreground underline underline-offset-2"
            >
              {m.integration_kept_help_hosts_link()}
            </a>
          </p>
        </div>
      </details>
    {:else if integration.configured}
      <p class="text-muted-foreground text-xs text-pretty">
        {m.integration_admin_only()}
      </p>
    {/if}
  </Card.Content>
</Card.Root>

<ConfirmDialog
  bind:open={disconnectOpen}
  title={m.integration_kept_disconnect_title()}
  description={m.integration_kept_disconnect_description()}
  confirmLabel={m.integration_disconnect_confirm()}
  pendingLabel={m.integration_disconnect_pending()}
  destructive
  onconfirm={disconnect}
/>
