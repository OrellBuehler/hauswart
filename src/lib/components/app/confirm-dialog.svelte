<script lang="ts">
  import LoaderCircleIcon from "@lucide/svelte/icons/loader-circle";
  import { Button } from "$lib/components/ui/button/index.js";
  import * as Dialog from "$lib/components/ui/dialog/index.js";
  import { apiErrorMessage } from "$lib/error-message";
  import { m } from "$lib/paraglide/messages";
  import FormAlert from "./form-alert.svelte";

  let {
    open = $bindable(false),
    title,
    description,
    confirmLabel,
    pendingLabel,
    destructive = false,
    onconfirm,
    closeOnBack,
  }: {
    open?: boolean;
    title: string;
    description: string;
    confirmLabel: string;
    pendingLabel: string;
    destructive?: boolean;
    /** Runs the action. A thrown error is shown in the dialog, which stays open. */
    onconfirm: () => Promise<void>;
    /** The back gesture closes the dialog (default, but not while the action runs); `false` leaves it to the page. */
    closeOnBack?: boolean;
  } = $props();

  let pending = $state(false);
  let error = $state<string | undefined>();

  $effect(() => {
    if (open) error = undefined;
  });

  async function confirm() {
    pending = true;
    error = undefined;
    try {
      await onconfirm();
      open = false;
    } catch (err) {
      error = apiErrorMessage(err);
    } finally {
      pending = false;
    }
  }
</script>

<Dialog.Root
  bind:open={() => open, (value) => (open = pending ? true : value)}
  closeOnBack={(closeOnBack ?? true) && !pending}
>
  <Dialog.Content showCloseButton={false}>
    <Dialog.Header>
      <Dialog.Title>{title}</Dialog.Title>
      <Dialog.Description>{description}</Dialog.Description>
    </Dialog.Header>
    <FormAlert message={error} />
    <Dialog.Footer class="gap-2">
      <Button
        type="button"
        variant="outline"
        class="max-sm:w-full pointer-coarse:h-11"
        disabled={pending}
        onclick={() => (open = false)}
      >
        {m.common_cancel()}
      </Button>
      <Button
        type="button"
        variant={destructive ? "destructive" : "default"}
        class="max-sm:w-full pointer-coarse:h-11"
        disabled={pending}
        onclick={confirm}
      >
        {#if pending}
          <LoaderCircleIcon class="animate-spin" />{pendingLabel}
        {:else}
          {confirmLabel}
        {/if}
      </Button>
    </Dialog.Footer>
  </Dialog.Content>
</Dialog.Root>
