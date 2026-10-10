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
    closeOnBack,
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
    /** The back gesture closes the dialog (default); `false` leaves it to the page. */
    closeOnBack?: boolean;
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

<Dialog.Root
  bind:open={() => open, (value) => (open = pending ? true : value)}
  {closeOnBack}
>
  <Dialog.Content
    class={cn("flex flex-col gap-0 overflow-hidden p-0", className)}
  >
    <Dialog.Header class="border-b p-4 pe-12 sm:px-6 sm:py-5 sm:pe-12">
      <Dialog.Title>{title}</Dialog.Title>
      {#if description}
        <Dialog.Description>{description}</Dialog.Description>
      {:else}
        <Dialog.Description class="sr-only">{title}</Dialog.Description>
      {/if}
    </Dialog.Header>
    <form
      class="flex min-h-0 min-w-0 flex-1 flex-col"
      novalidate
      onsubmit={submit}
    >
      <div
        class="grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)] content-start gap-5 overflow-y-auto overscroll-contain p-4 sm:px-6 sm:py-5"
      >
        {@render children()}
      </div>
      <div
        class="bg-background flex flex-col gap-3 border-t px-4 py-3 sm:px-6 sm:py-4"
      >
        <FormAlert message={error} />
        <Dialog.Footer class="flex-row flex-wrap-reverse gap-2 max-sm:*:flex-1">
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
      </div>
    </form>
  </Dialog.Content>
</Dialog.Root>
