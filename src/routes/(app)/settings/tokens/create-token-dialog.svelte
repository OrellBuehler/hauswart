<script lang="ts">
  import LoaderCircleIcon from "@lucide/svelte/icons/loader-circle";
  import TriangleAlertIcon from "@lucide/svelte/icons/triangle-alert";
  import { toast } from "svelte-sonner";
  import { SCOPES, type Scope } from "$lib/api/scopes";
  import { endpoints } from "$lib/api/registry";
  import { api } from "$lib/api/browser";
  import { TOKEN_NAME_MAX } from "$lib/api/schemas/tokens";
  import { CREATABLE_TOKEN_KINDS } from "$lib/api/schemas/tokens";
  import CopyButton from "$lib/components/app/copy-button.svelte";
  import FormAlert from "$lib/components/app/form-alert.svelte";
  import {
    kindLabel,
    scopeHint,
    scopeLabel,
  } from "$lib/components/app/token-labels";
  import * as Alert from "$lib/components/ui/alert/index.js";
  import { Button } from "$lib/components/ui/button/index.js";
  import { Checkbox } from "$lib/components/ui/checkbox/index.js";
  import * as Dialog from "$lib/components/ui/dialog/index.js";
  import { Input } from "$lib/components/ui/input/index.js";
  import { Label } from "$lib/components/ui/label/index.js";
  import * as Select from "$lib/components/ui/select/index.js";
  import { apiErrorMessage } from "$lib/error-message";
  import { m } from "$lib/paraglide/messages";

  type Kind = (typeof CREATABLE_TOKEN_KINDS)[number];

  let {
    open = $bindable(false),
    scopes,
    oncreated,
  }: {
    open?: boolean;
    /** The scopes the caller holds: a token cannot exceed them. */
    scopes: readonly Scope[];
    oncreated: () => void | Promise<void>;
  } = $props();

  const available = $derived(SCOPES.filter((scope) => scopes.includes(scope)));

  let name = $state("");
  let kind = $state<Kind>("integration");
  let selected = $state<Scope[]>(["read"]);
  let expiry = $state("");
  let pending = $state(false);
  let error = $state<string | undefined>();
  let created = $state<{ name: string; token: string } | undefined>();
  let revealOpen = $state(false);

  const today = new Date();
  const minExpiry = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;

  $effect(() => {
    if (open) {
      name = "";
      kind = "integration";
      selected = ["read"];
      expiry = "";
      error = undefined;
    }
  });

  function toggle(scope: Scope, checked: boolean) {
    selected = checked
      ? [...selected, scope]
      : selected.filter((s) => s !== scope);
  }

  async function submit(event: SubmitEvent) {
    event.preventDefault();
    if (pending) return;
    if (selected.length === 0) {
      error = m.tokens_scopes_required();
      return;
    }
    let expiresAt: string | undefined;
    if (expiry) {
      const end = new Date(`${expiry}T23:59:59`);
      if (Number.isNaN(end.getTime()) || end.getTime() <= Date.now()) {
        error = m.tokens_expiry_past();
        return;
      }
      expiresAt = end.toISOString();
    }
    pending = true;
    error = undefined;
    try {
      const result = await api.call(endpoints.tokensCreate, {
        body: {
          name,
          kind,
          scopes: SCOPES.filter((scope) => selected.includes(scope)),
          ...(expiresAt ? { expiresAt } : {}),
        },
      });
      created = { name: result.name, token: result.token };
      open = false;
      revealOpen = true;
      toast.success(m.tokens_created_toast({ name: result.name }));
      await oncreated();
    } catch (err) {
      error = apiErrorMessage(err);
    } finally {
      pending = false;
    }
  }

  function done() {
    revealOpen = false;
    created = undefined;
  }
</script>

<Dialog.Root bind:open={() => open, (value) => (open = pending ? true : value)}>
  <Dialog.Content class="max-h-[calc(100svh-2rem)] overflow-y-auto">
    <Dialog.Header>
      <Dialog.Title>{m.tokens_create_title()}</Dialog.Title>
      <Dialog.Description>{m.tokens_create_description()}</Dialog.Description>
    </Dialog.Header>
    <form class="flex flex-col gap-5" onsubmit={submit}>
      <div class="flex flex-col gap-2">
        <Label for="token-name">{m.tokens_name()}</Label>
        <Input
          id="token-name"
          required
          maxlength={TOKEN_NAME_MAX}
          placeholder={m.tokens_name_placeholder()}
          autocomplete="off"
          bind:value={name}
        />
      </div>
      <div class="flex flex-col gap-2">
        <Label for="token-kind">{m.tokens_kind()}</Label>
        <Select.Root type="single" bind:value={kind}>
          <Select.Trigger id="token-kind" class="w-full">
            {kindLabel(kind)}
          </Select.Trigger>
          <Select.Content>
            {#each CREATABLE_TOKEN_KINDS as option (option)}
              <Select.Item value={option} label={kindLabel(option)} />
            {/each}
          </Select.Content>
        </Select.Root>
      </div>
      <fieldset class="flex flex-col gap-3">
        <legend class="mb-1 text-sm font-medium">{m.tokens_scopes()}</legend>
        {#each available as scope (scope)}
          <div class="flex items-start gap-3">
            <Checkbox
              id={`scope-${scope}`}
              class="mt-0.5"
              checked={selected.includes(scope)}
              onCheckedChange={(checked) => toggle(scope, checked)}
            />
            <Label
              for={`scope-${scope}`}
              class="flex flex-col items-start gap-0.5"
            >
              <span>{scopeLabel(scope)}</span>
              <span class="text-muted-foreground text-xs font-normal">
                {scopeHint(scope)}
              </span>
            </Label>
          </div>
        {/each}
      </fieldset>
      <div class="flex flex-col gap-2">
        <Label for="token-expiry">
          {m.tokens_expiry()}
          <span class="text-muted-foreground font-normal"
            >({m.common_optional()})</span
          >
        </Label>
        <Input
          id="token-expiry"
          type="date"
          min={minExpiry}
          bind:value={expiry}
        />
        <p class="text-muted-foreground text-xs">{m.tokens_expiry_hint()}</p>
      </div>
      <FormAlert message={error} />
      <Dialog.Footer>
        <Button
          type="button"
          variant="outline"
          disabled={pending}
          onclick={() => (open = false)}
        >
          {m.common_cancel()}
        </Button>
        <Button type="submit" disabled={pending}>
          {#if pending}
            <LoaderCircleIcon class="animate-spin" />{m.common_creating()}
          {:else}
            {m.common_create()}
          {/if}
        </Button>
      </Dialog.Footer>
    </form>
  </Dialog.Content>
</Dialog.Root>

<Dialog.Root bind:open={revealOpen}>
  <Dialog.Content
    showCloseButton={false}
    interactOutsideBehavior="ignore"
    escapeKeydownBehavior="ignore"
  >
    <Dialog.Header>
      <Dialog.Title>{m.tokens_created_title()}</Dialog.Title>
      <Dialog.Description>
        {m.tokens_created_description({ name: created?.name ?? "" })}
      </Dialog.Description>
    </Dialog.Header>
    <Alert.Root class="border-warning/50">
      <TriangleAlertIcon class="text-warning" />
      <Alert.Title>{m.tokens_created_warning_title()}</Alert.Title>
      <Alert.Description>{m.tokens_created_warning()}</Alert.Description>
    </Alert.Root>
    <div class="flex flex-col gap-2">
      <Label for="token-value">{m.tokens_created_value_label()}</Label>
      <div class="flex items-stretch gap-2">
        <code
          id="token-value"
          class="bg-muted min-w-0 flex-1 rounded-md px-3 py-2 font-mono text-xs break-all select-all"
        >
          {created?.token ?? ""}
        </code>
        <CopyButton
          value={created?.token ?? ""}
          iconOnly
          label={m.common_copy()}
        />
      </div>
    </div>
    <Dialog.Footer>
      <Button type="button" onclick={done}>{m.tokens_created_done()}</Button>
    </Dialog.Footer>
  </Dialog.Content>
</Dialog.Root>
