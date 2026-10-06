<script lang="ts">
  import ClipboardCopyIcon from "@lucide/svelte/icons/clipboard-copy";
  import LoaderCircleIcon from "@lucide/svelte/icons/loader-circle";
  import SaveIcon from "@lucide/svelte/icons/save";
  import DownloadIcon from "@lucide/svelte/icons/download";
  import FormAlert from "$lib/components/app/form-alert.svelte";
  import { Button } from "$lib/components/ui/button/index.js";
  import * as Dialog from "$lib/components/ui/dialog/index.js";
  import { m } from "$lib/paraglide/messages";

  let {
    open = $bindable(false),
    myRev,
    currentRev,
    pending = false,
    error,
    onreload,
    onkeep,
    oncopy,
  }: {
    open?: boolean;
    /** The revision the editor started from. */
    myRev: number;
    currentRev: number | undefined;
    pending?: boolean;
    error?: string | undefined;
    /** Discard my changes and load the current version. */
    onreload: () => void;
    /** Save my version over the current one. */
    onkeep: () => void;
    /** Copy my text to the clipboard. */
    oncopy: () => void;
  } = $props();
</script>

<Dialog.Root bind:open={() => open, (value) => (open = pending ? true : value)}>
  <Dialog.Content class="max-h-[calc(100svh-2rem)] overflow-y-auto">
    <Dialog.Header>
      <Dialog.Title>{m.editor_conflict_title()}</Dialog.Title>
      <Dialog.Description>
        {currentRev !== undefined
          ? m.editor_conflict_description({ mine: myRev, theirs: currentRev })
          : m.editor_conflict_description_unknown({ mine: myRev })}
      </Dialog.Description>
    </Dialog.Header>
    <FormAlert message={error} />
    <div class="flex flex-col gap-2">
      <Button
        type="button"
        size="lg"
        variant="outline"
        class="h-auto justify-start py-2.5 text-start whitespace-normal"
        disabled={pending}
        onclick={onreload}
      >
        <DownloadIcon />
        <span class="flex flex-col items-start gap-0.5">
          <span>{m.editor_conflict_reload()}</span>
          <span class="text-muted-foreground text-xs font-normal"
            >{m.editor_conflict_reload_hint()}</span
          >
        </span>
      </Button>
      <Button
        type="button"
        size="lg"
        variant="outline"
        class="h-auto justify-start py-2.5 text-start whitespace-normal"
        disabled={pending}
        onclick={onkeep}
      >
        {#if pending}<LoaderCircleIcon class="animate-spin" />{:else}<SaveIcon
          />{/if}
        <span class="flex flex-col items-start gap-0.5">
          <span>{m.editor_conflict_keep()}</span>
          <span class="text-muted-foreground text-xs font-normal"
            >{m.editor_conflict_keep_hint()}</span
          >
        </span>
      </Button>
      <Button
        type="button"
        size="lg"
        variant="outline"
        class="h-auto justify-start py-2.5 text-start whitespace-normal"
        disabled={pending}
        onclick={oncopy}
      >
        <ClipboardCopyIcon />
        <span class="flex flex-col items-start gap-0.5">
          <span>{m.editor_conflict_copy()}</span>
          <span class="text-muted-foreground text-xs font-normal"
            >{m.editor_conflict_copy_hint()}</span
          >
        </span>
      </Button>
    </div>
    <Dialog.Footer>
      <Button
        type="button"
        variant="ghost"
        size="lg"
        disabled={pending}
        onclick={() => (open = false)}
      >
        {m.editor_conflict_close()}
      </Button>
    </Dialog.Footer>
  </Dialog.Content>
</Dialog.Root>
