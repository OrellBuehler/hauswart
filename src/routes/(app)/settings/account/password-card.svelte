<script lang="ts">
  import LoaderCircleIcon from "@lucide/svelte/icons/loader-circle";
  import { toast } from "svelte-sonner";
  import { endpoints } from "$lib/api/registry";
  import { api } from "$lib/api/browser";
  import { PASSWORD_MAX, PASSWORD_MIN } from "$lib/api/schemas/auth";
  import FormAlert from "$lib/components/app/form-alert.svelte";
  import Field from "$lib/components/tasks/field.svelte";
  import { Button } from "$lib/components/ui/button/index.js";
  import * as Card from "$lib/components/ui/card/index.js";
  import { Checkbox } from "$lib/components/ui/checkbox/index.js";
  import { Input } from "$lib/components/ui/input/index.js";
  import { apiErrorMessage } from "$lib/error-message";
  import { m } from "$lib/paraglide/messages";
  import { apiFieldErrors } from "$lib/tasks/field-errors";

  let { username }: { username: string } = $props();

  let currentPassword = $state("");
  let newPassword = $state("");
  let repeat = $state("");
  let reveal = $state(false);
  let pending = $state(false);
  let error = $state<string | undefined>();
  let fieldErrors = $state<Record<string, string>>({});

  const mismatch = $derived(repeat !== "" && repeat !== newPassword);

  function check(): Record<string, string> {
    const errors: Record<string, string> = {};
    if (newPassword.length < PASSWORD_MIN) {
      errors.newPassword = m.auth_password_hint();
    } else if (newPassword === currentPassword) {
      errors.newPassword = m.account_password_same();
    }
    if (repeat !== newPassword) errors.repeat = m.auth_passwords_mismatch();
    return errors;
  }

  async function submit(event: SubmitEvent) {
    event.preventDefault();
    if (pending) return;
    error = undefined;
    fieldErrors = check();
    if (Object.keys(fieldErrors).length > 0) return;
    pending = true;
    try {
      await api.call(endpoints.authChangePassword, {
        body: { currentPassword, newPassword },
      });
      currentPassword = "";
      newPassword = "";
      repeat = "";
      toast.success(m.account_password_changed());
    } catch (err) {
      const fields = apiFieldErrors(err);
      if (fields.currentPassword) {
        fieldErrors = { currentPassword: m.account_password_current_wrong() };
      } else if (fields.newPassword) {
        fieldErrors = { newPassword: m.account_password_same() };
      } else {
        error = apiErrorMessage(err);
      }
    } finally {
      pending = false;
    }
  }
</script>

<Card.Root>
  <Card.Header>
    <Card.Title>{m.account_password_title()}</Card.Title>
    <Card.Description>{m.account_password_description()}</Card.Description>
  </Card.Header>
  <Card.Content>
    <form class="flex flex-col gap-5" onsubmit={submit}>
      <FormAlert message={error} />
      <input
        type="text"
        name="username"
        autocomplete="username"
        value={username}
        readonly
        tabindex={-1}
        aria-hidden="true"
        class="sr-only"
      />
      <Field
        id="current-password"
        label={m.account_password_current()}
        error={fieldErrors.currentPassword}
      >
        {#snippet children({ describedby, invalid })}
          <Input
            id="current-password"
            name="current-password"
            type={reveal ? "text" : "password"}
            autocomplete="current-password"
            required
            maxlength={PASSWORD_MAX}
            aria-invalid={invalid || undefined}
            aria-describedby={describedby}
            bind:value={currentPassword}
          />
        {/snippet}
      </Field>
      <Field
        id="new-password"
        label={m.account_password_new()}
        hint={m.auth_password_hint()}
        error={fieldErrors.newPassword}
      >
        {#snippet children({ describedby, invalid })}
          <Input
            id="new-password"
            name="new-password"
            type={reveal ? "text" : "password"}
            autocomplete="new-password"
            required
            minlength={PASSWORD_MIN}
            maxlength={PASSWORD_MAX}
            aria-invalid={invalid || undefined}
            aria-describedby={describedby}
            bind:value={newPassword}
          />
        {/snippet}
      </Field>
      <Field
        id="repeat-password"
        label={m.account_password_repeat()}
        error={mismatch ? m.auth_passwords_mismatch() : fieldErrors.repeat}
      >
        {#snippet children({ describedby, invalid })}
          <Input
            id="repeat-password"
            name="repeat-password"
            type={reveal ? "text" : "password"}
            autocomplete="new-password"
            required
            maxlength={PASSWORD_MAX}
            aria-invalid={invalid || undefined}
            aria-describedby={describedby}
            bind:value={repeat}
          />
        {/snippet}
      </Field>
      <label
        class="flex min-h-10 w-fit cursor-pointer items-center gap-3 text-sm"
      >
        <Checkbox bind:checked={reveal} />
        {m.account_password_show()}
      </label>
      <div>
        <Button type="submit" disabled={pending || mismatch}>
          {#if pending}
            <LoaderCircleIcon
              class="animate-spin"
            />{m.account_password_pending()}
          {:else}
            {m.account_password_submit()}
          {/if}
        </Button>
      </div>
    </form>
  </Card.Content>
</Card.Root>
