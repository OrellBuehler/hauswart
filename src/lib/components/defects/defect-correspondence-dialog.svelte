<script lang="ts">
  import LoaderCircleIcon from "@lucide/svelte/icons/loader-circle";
  import { invalidateAll } from "$app/navigation";
  import { toast } from "svelte-sonner";
  import { api } from "$lib/api/browser";
  import { endpoints } from "$lib/api/registry";
  import FormAlert from "$lib/components/app/form-alert.svelte";
  import { Button } from "$lib/components/ui/button/index.js";
  import * as Dialog from "$lib/components/ui/dialog/index.js";
  import { Input } from "$lib/components/ui/input/index.js";
  import { Label } from "$lib/components/ui/label/index.js";
  import { Textarea } from "$lib/components/ui/textarea/index.js";
  import { apiErrorMessage } from "$lib/error-message";
  import { m } from "$lib/paraglide/messages";

  let {
    open = $bindable(false),
    defectId,
  }: { open?: boolean; defectId: string } = $props();

  let body = $state("");
  let reference = $state("");
  let pending = $state(false);
  let error = $state<string | undefined>();

  $effect(() => {
    if (!open) return;
    body = "";
    reference = "";
    error = undefined;
  });

  async function submit(event: SubmitEvent) {
    event.preventDefault();
    if (pending) return;
    if (body.trim() === "") {
      error = m.field_required();
      return;
    }
    pending = true;
    error = undefined;
    try {
      await api.call(endpoints.defectsAddEvent, {
        params: { id: defectId },
        body: {
          type: "correspondence",
          bodyMd: body,
          ...(reference.trim() ? { externalRef: reference } : {}),
        },
      });
      toast.success(m.defect_correspondence_toast());
      open = false;
      await invalidateAll();
    } catch (err) {
      error = apiErrorMessage(err);
    } finally {
      pending = false;
    }
  }
</script>

<Dialog.Root bind:open={() => open, (value) => (open = pending ? true : value)}>
  <Dialog.Content class="max-h-[calc(100svh-2rem)] overflow-y-auto">
    <Dialog.Header>
      <Dialog.Title>{m.defect_correspondence_title()}</Dialog.Title>
      <Dialog.Description
        >{m.defect_correspondence_description()}</Dialog.Description
      >
    </Dialog.Header>
    <form class="flex flex-col gap-5" onsubmit={submit}>
      <div class="flex flex-col gap-2">
        <Label for="corr-body">{m.defect_correspondence_body()}</Label>
        <Textarea
          id="corr-body"
          rows={4}
          required
          maxlength={10000}
          placeholder={m.defect_correspondence_placeholder()}
          bind:value={body}
        />
      </div>
      <div class="flex flex-col gap-2">
        <Label for="corr-ref">
          {m.defect_correspondence_reference()}
          <span class="text-muted-foreground font-normal"
            >({m.common_optional()})</span
          >
        </Label>
        <Input
          id="corr-ref"
          class="h-10"
          maxlength={255}
          autocomplete="off"
          bind:value={reference}
        />
        <p class="text-muted-foreground text-xs">
          {m.defect_correspondence_reference_hint()}
        </p>
      </div>
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
            <LoaderCircleIcon class="animate-spin" />
          {/if}
          {m.defect_correspondence_submit()}
        </Button>
      </Dialog.Footer>
    </form>
  </Dialog.Content>
</Dialog.Root>
