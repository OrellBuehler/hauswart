<script lang="ts">
  import LoaderCircleIcon from "@lucide/svelte/icons/loader-circle";
  import { toast } from "svelte-sonner";
  import { endpoints } from "$lib/api/registry";
  import { api } from "$lib/api/browser";
  import { PASSWORD_MAX, PASSWORD_MIN } from "$lib/api/schemas/auth";
  import type { AdminUser } from "$lib/api/schemas/users";
  import FormAlert from "$lib/components/app/form-alert.svelte";
  import { Button } from "$lib/components/ui/button/index.js";
  import * as Dialog from "$lib/components/ui/dialog/index.js";
  import { Input } from "$lib/components/ui/input/index.js";
  import { Label } from "$lib/components/ui/label/index.js";
  import { apiErrorMessage } from "$lib/error-message";
  import { m } from "$lib/paraglide/messages";

  let {
    open = $bindable(false),
    user,
    onsaved,
  }: {
    open?: boolean;
    user: AdminUser | undefined;
    onsaved: () => void | Promise<void>;
  } = $props();

  const name = $derived(user ? user.displayName || user.username : "");

  let password = $state("");
  let pending = $state(false);
  let error = $state<string | undefined>();

  $effect(() => {
    if (open) {
      password = "";
      error = undefined;
    }
  });

  async function submit(event: SubmitEvent) {
    event.preventDefault();
    if (!user || pending) return;
    pending = true;
    error = undefined;
    try {
      await api.call(endpoints.usersUpdate, {
        params: { id: user.id },
        body: { password },
      });
      open = false;
      toast.success(m.admin_users_reset_toast({ name }));
      await onsaved();
    } catch (err) {
      error = apiErrorMessage(err);
    } finally {
      pending = false;
    }
  }
</script>

<Dialog.Root bind:open={() => open, (value) => (open = pending ? true : value)}>
  <Dialog.Content>
    <Dialog.Header>
      <Dialog.Title>{m.admin_users_reset_title()}</Dialog.Title>
      <Dialog.Description>
        {m.admin_users_reset_description({ name })}
      </Dialog.Description>
    </Dialog.Header>
    <form class="flex flex-col gap-5" onsubmit={submit}>
      <div class="flex flex-col gap-2">
        <Label for="reset-password">{m.admin_users_new_password()}</Label>
        <Input
          id="reset-password"
          type="text"
          autocomplete="off"
          autocapitalize="none"
          autocorrect="off"
          enterkeyhint="done"
          spellcheck={false}
          required
          minlength={PASSWORD_MIN}
          maxlength={PASSWORD_MAX}
          bind:value={password}
        />
        <p class="text-muted-foreground text-xs">{m.auth_password_hint()}</p>
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
            <LoaderCircleIcon
              class="animate-spin"
            />{m.admin_users_reset_pending()}
          {:else}
            {m.admin_users_reset_confirm()}
          {/if}
        </Button>
      </Dialog.Footer>
    </form>
  </Dialog.Content>
</Dialog.Root>
