<script lang="ts">
  import { resolve } from "$app/paths";
  import CircleCheckIcon from "@lucide/svelte/icons/circle-check";
  import CircleXIcon from "@lucide/svelte/icons/circle-x";
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
  import { apiErrorMessage } from "$lib/error-message";
  import { forgetIntegrations } from "$lib/connections/connection";
  import { forgetReadings } from "$lib/connections/entities";
  import { integrationErrorMessage } from "$lib/connections/errors";
  import { formatDateTime, formatRelativeInstant } from "$lib/format";
  import { m } from "$lib/paraglide/messages";
  import type { IntegrationCardProps } from "./cards";
  import { kindMeta } from "./kinds";
  import StatusBadge from "./status-badge.svelte";

  type TestResult = z.infer<typeof testIntegrationResponseSchema>;

  let { integration, canEdit, timeZone, onchanged }: IntegrationCardProps =
    $props();

  const meta = kindMeta.homeassistant;
  const KIND = "homeassistant" as const;

  /* The form is seeded once; saving reloads the list and the baselines below. */
  /* svelte-ignore state_referenced_locally */
  let baseUrl = $state(integration.baseUrl ?? "");
  let token = $state("");
  /* svelte-ignore state_referenced_locally */
  let replaceToken = $state(!integration.configured);
  /* svelte-ignore state_referenced_locally */
  let allowInsecureTls = $state(integration.allowInsecureTls);
  /* svelte-ignore state_referenced_locally */
  let appUrl = $state(
    typeof integration.config.appUrl === "string"
      ? integration.config.appUrl
      : "",
  );
  /* svelte-ignore state_referenced_locally */
  let enabled = $state(integration.configured ? integration.enabled : true);

  let saving = $state(false);
  let testing = $state(false);
  let error = $state<string | undefined>();
  let fieldErrors = $state<Record<string, string>>({});
  let testResult = $state<TestResult | undefined>();
  let disconnectOpen = $state(false);
  /* svelte-ignore state_referenced_locally */
  let formOpen = $state(integration.enabled && integration.status === "error");
  $effect(() => {
    if (integration.enabled && integration.status === "error") formOpen = true;
  });

  const storedAppUrl = $derived(
    typeof integration.config.appUrl === "string"
      ? integration.config.appUrl
      : "",
  );
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
      appUrl.trim() !== storedAppUrl ||
      enabled !== (integration.configured ? integration.enabled : true),
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
    }
    if (appUrl.trim() !== "" && !/^https?:\/\//i.test(appUrl.trim())) {
      found.appUrl = m.integration_ha_url_invalid();
    }
    fieldErrors = found;
    return Object.keys(found).length === 0;
  }

  async function runTest(): Promise<TestResult | undefined> {
    testing = true;
    testResult = undefined;
    try {
      const result = await api.call(endpoints.integrationsTest, {
        params: { kind: KIND },
      });
      testResult = result;
      forgetIntegrations();
      forgetReadings();
      await onchanged();
      return result;
    } catch (err) {
      error = apiErrorMessage(err);
      return undefined;
    } finally {
      testing = false;
    }
  }

  async function submit(event: SubmitEvent) {
    event.preventDefault();
    if (!canEdit || saving || testing) return;
    error = undefined;
    if (!validate()) return;
    formOpen = true;
    saving = true;
    try {
      const saved = await api.call(endpoints.integrationsSave, {
        params: { kind: KIND },
        body: {
          baseUrl: baseUrl.trim(),
          ...(token.trim() !== "" ? { token: token.trim() } : {}),
          allowInsecureTls,
          config: { appUrl: appUrl.trim() },
          enabled,
        },
      });
      baseUrl = saved.baseUrl ?? baseUrl;
      appUrl =
        typeof saved.config.appUrl === "string" ? saved.config.appUrl : "";
      token = "";
      replaceToken = false;
      forgetIntegrations();
      forgetReadings();
      toast.success(m.integration_saved());
    } catch (err) {
      error = apiErrorMessage(err);
      saving = false;
      return;
    }
    saving = false;
    await onchanged();
    if (enabled) await runTest();
  }

  async function disconnect() {
    await api.call(endpoints.integrationsDelete, { params: { kind: KIND } });
    forgetIntegrations();
    forgetReadings();
    baseUrl = "";
    token = "";
    appUrl = "";
    allowInsecureTls = false;
    enabled = true;
    replaceToken = true;
    testResult = undefined;
    error = undefined;
    fieldErrors = {};
    toast.success(m.integration_disconnected());
    await onchanged();
  }

  const infoLine = $derived.by(() => {
    const info = testResult?.info;
    if (!info) return undefined;
    const parts = [
      typeof info.locationName === "string" && info.locationName
        ? `«${info.locationName}»`
        : null,
      typeof info.version === "string"
        ? `Home Assistant ${info.version}`
        : null,
      typeof info.timeZone === "string" ? info.timeZone : null,
    ].filter(Boolean);
    return parts.join(" · ");
  });
</script>

<Card.Root>
  <Card.Header>
    <div
      class="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between sm:gap-x-3"
    >
      <div class="flex min-w-0 items-center gap-3">
        <span
          class="bg-brand/10 text-brand flex size-10 shrink-0 items-center justify-center rounded-lg"
          aria-hidden="true"
        >
          <meta.icon class="size-5" />
        </span>
        <Card.Title class="min-w-0 text-base">{meta.name()}</Card.Title>
      </div>
      <StatusBadge class="self-start" {integration} />
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
            {integrationErrorMessage(integration.lastError)}
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
          <dt class="text-muted-foreground">{m.integration_ha_url()}</dt>
          <dd class="min-w-0 font-mono text-xs break-all">
            {integration.baseUrl}
          </dd>
        {/if}
      </dl>
    {:else if !canEdit}
      <p class="text-muted-foreground text-sm text-pretty">
        {m.integration_ha_not_connected_member()}
      </p>
    {/if}

    {#if testResult}
      <div
        role="status"
        class={testResult.ok
          ? "bg-success/10 text-foreground flex items-start gap-3 rounded-lg border border-transparent px-4 py-3 text-sm"
          : "bg-destructive/10 text-foreground flex items-start gap-3 rounded-lg border border-transparent px-4 py-3 text-sm"}
      >
        {#if testResult.ok}
          <CircleCheckIcon
            class="text-success mt-0.5 size-4 shrink-0"
            aria-hidden="true"
          />
          <div class="flex min-w-0 flex-col gap-0.5">
            <p class="font-medium">{m.integration_test_ok()}</p>
            {#if infoLine}
              <p class="text-muted-foreground text-xs break-words">
                {infoLine}
              </p>
            {/if}
          </div>
        {:else}
          <CircleXIcon
            class="text-destructive mt-0.5 size-4 shrink-0"
            aria-hidden="true"
          />
          <div class="flex min-w-0 flex-col gap-0.5">
            <p class="font-medium">{m.integration_test_failed()}</p>
            <p class="text-muted-foreground text-xs text-pretty">
              {integrationErrorMessage(testResult.error?.code ?? null)}
            </p>
          </div>
        {/if}
      </div>
    {/if}

    {#if canEdit}
      {#snippet connectionForm()}
        <form
          method="post"
          class="flex flex-col gap-5"
          onsubmit={submit}
          novalidate
        >
          <FormAlert message={error} />

          <Field
            id="ha-url"
            label={m.integration_ha_url()}
            hint={m.integration_ha_url_hint()}
            error={fieldErrors.baseUrl}
          >
            {#snippet children({ describedby, invalid })}
              <Input
                id="ha-url"
                type="url"
                inputmode="url"
                class="h-10"
                autocomplete="off"
                autocapitalize="none"
                spellcheck={false}
                placeholder="https://homeassistant.example.org:8123"
                bind:value={baseUrl}
                aria-invalid={invalid || undefined}
                aria-describedby={describedby}
              />
            {/snippet}
          </Field>

          {#if showTokenInput}
            <Field
              id="ha-token"
              label={m.integration_ha_token()}
              hint={urlChanged
                ? m.integration_ha_token_hint_url()
                : m.integration_ha_token_hint()}
              error={fieldErrors.token}
            >
              {#snippet children({ describedby, invalid })}
                <Input
                  id="ha-token"
                  type="password"
                  class="h-10 font-mono"
                  autocomplete="new-password"
                  autocapitalize="none"
                  spellcheck={false}
                  data-1p-ignore
                  data-lpignore="true"
                  data-bwignore
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
                >{m.integration_ha_token()}</span
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
                  class="shrink-0"
                  onclick={() => (replaceToken = true)}
                >
                  {m.integration_ha_token_replace()}
                </Button>
              </div>
            </div>
          {/if}

          <div class="flex flex-col gap-3">
            <SwitchField
              id="ha-insecure"
              bind:checked={allowInsecureTls}
              label={m.integration_ha_insecure()}
              hint={m.integration_ha_insecure_hint()}
            />
            {#if allowInsecureTls}
              <Alert.Root class="border-warning/50">
                <LockKeyholeIcon class="text-warning" />
                <Alert.Description class="text-pretty">
                  {m.integration_ha_insecure_warning()}
                </Alert.Description>
              </Alert.Root>
            {/if}
          </div>

          <Field
            id="ha-app-url"
            label={m.integration_ha_app_url()}
            hint={m.integration_ha_app_url_hint()}
            optional
            error={fieldErrors.appUrl}
          >
            {#snippet children({ describedby, invalid })}
              <Input
                id="ha-app-url"
                type="url"
                inputmode="url"
                class="h-10"
                autocomplete="off"
                autocapitalize="none"
                spellcheck={false}
                placeholder="https://hauswart.example.org"
                bind:value={appUrl}
                aria-invalid={invalid || undefined}
                aria-describedby={describedby}
              />
            {/snippet}
          </Field>

          {#if integration.configured}
            <SwitchField
              id="ha-enabled"
              bind:checked={enabled}
              label={m.integration_ha_enabled()}
              hint={m.integration_ha_enabled_hint()}
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
      {/snippet}
      {#if integration.configured}
        <details class="rounded-lg border text-sm" bind:open={formOpen}>
          <summary
            class="focus-visible:ring-ring/50 cursor-pointer rounded-lg px-4 py-3 font-medium outline-none select-none focus-visible:ring-[3px]"
          >
            {m.integration_edit_connection()}
          </summary>
          <div class="border-t p-4">
            {@render connectionForm()}
          </div>
        </details>
      {:else}
        {@render connectionForm()}
      {/if}

      <details class="group rounded-lg border text-sm">
        <summary
          class="focus-visible:ring-ring/50 cursor-pointer rounded-lg px-4 py-3 font-medium outline-none select-none focus-visible:ring-[3px]"
        >
          {m.integration_ha_help_title()}
        </summary>
        <div
          class="text-muted-foreground flex flex-col gap-3 px-4 pb-4 text-pretty"
        >
          <ol class="flex list-decimal flex-col gap-1.5 ps-5">
            <li>{m.integration_ha_help_step1()}</li>
            <li>{m.integration_ha_help_step2()}</li>
            <li>{m.integration_ha_help_step3()}</li>
            <li>{m.integration_ha_help_step4()}</li>
            <li>{m.integration_ha_help_step5()}</li>
          </ol>
          <p>{m.integration_ha_help_rights()}</p>
          <p>
            {m.integration_ha_help_push()}
            <a
              href={resolve("/settings/notifications")}
              class="text-foreground underline underline-offset-2 pointer-coarse:inline-flex pointer-coarse:min-h-10 pointer-coarse:items-center"
            >
              {m.integration_ha_help_push_link()}
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
  title={m.integration_disconnect_title()}
  description={m.integration_disconnect_description()}
  confirmLabel={m.integration_disconnect_confirm()}
  pendingLabel={m.integration_disconnect_pending()}
  destructive
  onconfirm={disconnect}
/>
