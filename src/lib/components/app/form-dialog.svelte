<script lang="ts">
  import LoaderCircleIcon from "@lucide/svelte/icons/loader-circle";
  import type { Snippet } from "svelte";
  import FormAlert from "$lib/components/app/form-alert.svelte";
  import { Button } from "$lib/components/ui/button/index.js";
  import * as Dialog from "$lib/components/ui/dialog/index.js";
  import { apiErrorMessage } from "$lib/error-message";
  import { m } from "$lib/paraglide/messages";
  import { cn } from "$lib/utils";

  let {
    open = $bindable(false),
    title,
    description,
    submitLabel,
    pendingLabel,
    onsubmit,
    children,
    class: className,
  }: {
    open?: boolean;
    title: string;
    description?: string;
    submitLabel: string;
    pendingLabel?: string;
    /** Runs the action. A returned string (or a thrown API error) is shown in the dialog, which stays open. */
    onsubmit: () => Promise<string | void>;
    children: Snippet;
    class?: string;
  } = $props();

  let pending = $state(false);
  let error = $state<string | undefined>();

  $effect(() => {
    if (open) error = undefined;
  });

  async function submit(event: SubmitEvent) {
    event.preventDefault();
    if (pending) return;
    pending = true;
    error = undefined;
    try {
      const problem = await onsubmit();
      if (typeof problem === "string") error = problem;
      else open = false;
    } catch (err) {
      error = apiErrorMessage(err);
    } finally {
      pending = false;
    }
  }
</script>

<Dialog.Root bind:open={() => open, (value) => (open = pending ? true : value)}>
  <Dialog.Content
    class={cn("max-h-[calc(100svh-2rem)] overflow-y-auto", className)}
  >
    <Dialog.Header>
      <Dialog.Title>{title}</Dialog.Title>
      {#if description}
        <Dialog.Description>{description}</Dialog.Description>
      {:else}
        <Dialog.Description class="sr-only">{title}</Dialog.Description>
      {/if}
    </Dialog.Header>
    <form class="flex min-w-0 flex-col gap-5" novalidate onsubmit={submit}>
      {@render children()}
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
            <LoaderCircleIcon class="animate-spin" />{pendingLabel ??
              m.common_saving()}
          {:else}
            {submitLabel}
          {/if}
        </Button>
      </Dialog.Footer>
    </form>
  </Dialog.Content>
</Dialog.Root>
