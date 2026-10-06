<script lang="ts">
  import ExternalLinkIcon from "@lucide/svelte/icons/external-link";
  import LockKeyholeIcon from "@lucide/svelte/icons/lock-keyhole";
  import ShareIcon from "@lucide/svelte/icons/share-2";
  import TriangleAlertIcon from "@lucide/svelte/icons/triangle-alert";
  import { toast } from "svelte-sonner";
  import { page } from "$app/state";
  import type { CreatedGuestLink } from "$lib/api/schemas/share";
  import CopyButton from "$lib/components/app/copy-button.svelte";
  import QrCode from "$lib/components/assets/qr-code.svelte";
  import * as Alert from "$lib/components/ui/alert/index.js";
  import { Button } from "$lib/components/ui/button/index.js";
  import * as Dialog from "$lib/components/ui/dialog/index.js";
  import { m } from "$lib/paraglide/messages";
  import { absoluteUrl } from "$lib/share/urls";

  let {
    open = $bindable(false),
    link,
    pin,
    rotated = false,
  }: {
    open?: boolean;
    link: CreatedGuestLink | undefined;
    /** The PIN just set, shown here because the API never returns it. */
    pin: string | null;
    rotated?: boolean;
  } = $props();

  const url = $derived(link ? absoluteUrl(link.url, page.url.origin) : "");
  const canShare = $derived(
    typeof navigator !== "undefined" && typeof navigator.share === "function",
  );

  async function share() {
    if (!link) return;
    try {
      await navigator.share({ title: link.label, url });
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") return;
      console.error("share failed", err);
      toast.error(m.glinks_share_failed());
    }
  }
</script>

<Dialog.Root bind:open>
  <Dialog.Content
    showCloseButton={false}
    interactOutsideBehavior="ignore"
    escapeKeydownBehavior="ignore"
    class="max-h-[calc(100svh-2rem)] overflow-y-auto"
  >
    <Dialog.Header>
      <Dialog.Title>
        {rotated ? m.glinks_rotated_title() : m.glinks_reveal_title()}
      </Dialog.Title>
      <Dialog.Description>
        {m.glinks_reveal_description({ label: link?.label ?? "" })}
      </Dialog.Description>
    </Dialog.Header>
    <Alert.Root class="border-warning/50">
      <TriangleAlertIcon class="text-warning" />
      <Alert.Title>{m.glinks_reveal_warning_title()}</Alert.Title>
      <Alert.Description>{m.glinks_reveal_warning()}</Alert.Description>
    </Alert.Root>
    <div class="flex flex-col items-center gap-2">
      <div class="w-full max-w-48 rounded-xl border bg-white p-1">
        <QrCode
          value={url}
          label={m.glinks_qr_label({ label: link?.label ?? "" })}
        />
      </div>
    </div>
    <div class="flex flex-col gap-2">
      <span class="text-sm font-medium">{m.glinks_url_label()}</span>
      <div class="flex items-stretch gap-2">
        <code
          class="bg-muted min-w-0 flex-1 rounded-md px-3 py-2 font-mono text-xs break-all select-all"
        >
          {url}
        </code>
        <CopyButton
          value={url}
          iconOnly
          label={m.glinks_copy_url()}
          copiedMessage={m.glinks_url_copied()}
        />
      </div>
      <div class="flex flex-wrap gap-2">
        {#if canShare}
          <Button type="button" variant="outline" onclick={share}>
            <ShareIcon />{m.glinks_share()}
          </Button>
        {/if}
        <Button
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          variant="outline"
        >
          <ExternalLinkIcon />{m.glinks_preview()}
        </Button>
      </div>
      <p class="text-muted-foreground text-xs text-pretty">
        {m.glinks_preview_hint()}
      </p>
    </div>
    {#if pin}
      <div class="flex flex-col gap-2 rounded-lg border p-3">
        <span class="flex items-center gap-1.5 text-sm font-medium">
          <LockKeyholeIcon
            class="size-4"
            aria-hidden="true"
          />{m.glinks_reveal_pin()}
        </span>
        <div class="flex items-center gap-2">
          <code
            class="bg-muted rounded-md px-3 py-1.5 font-mono text-lg tracking-widest tabular-nums select-all"
          >
            {pin}
          </code>
          <CopyButton
            value={pin}
            iconOnly
            label={m.glinks_copy_pin()}
            copiedMessage={m.glinks_pin_copied()}
          />
        </div>
        <p class="text-muted-foreground text-xs text-pretty">
          {m.glinks_reveal_pin_hint()}
        </p>
      </div>
    {/if}
    <Dialog.Footer>
      <Button type="button" onclick={() => (open = false)}>
        {m.glinks_reveal_done()}
      </Button>
    </Dialog.Footer>
  </Dialog.Content>
</Dialog.Root>
