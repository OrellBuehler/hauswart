<script lang="ts">
  import CalendarPlusIcon from "@lucide/svelte/icons/calendar-plus";
  import ChevronDownIcon from "@lucide/svelte/icons/chevron-down";
  import TriangleAlertIcon from "@lucide/svelte/icons/triangle-alert";
  import { page } from "$app/state";
  import type { CalendarFeed } from "$lib/api/schemas/share";
  import QrCode from "$lib/components/assets/qr-code.svelte";
  import CopyButton from "$lib/components/app/copy-button.svelte";
  import CalendarHowto from "$lib/components/share/calendar-howto.svelte";
  import Segmented from "$lib/components/tasks/segmented.svelte";
  import * as Alert from "$lib/components/ui/alert/index.js";
  import { Button } from "$lib/components/ui/button/index.js";
  import * as Dialog from "$lib/components/ui/dialog/index.js";
  import { m } from "$lib/paraglide/messages";
  import { absoluteUrl, webcalUrl } from "$lib/share/urls";

  let {
    open = $bindable(false),
    feed,
  }: { open?: boolean; feed: CalendarFeed | undefined } = $props();

  let format = $state<"webcal" | "https">("webcal");

  const https = $derived(
    feed?.url ? absoluteUrl(feed.url, page.url.origin) : null,
  );
  const webcal = $derived(https ? webcalUrl(https) : null);
  const qrValue = $derived(format === "webcal" ? webcal : https);

  $effect(() => {
    if (open) format = "webcal";
  });
</script>

{#snippet qr(value: string)}
  <div class="flex flex-col items-center gap-3">
    <div class="w-full max-w-56 rounded-xl border bg-white p-1">
      <QrCode {value} label={m.feeds_qr_label({ name: feed?.name ?? "" })} />
    </div>
    <Segmented
      label={m.feeds_qr_format()}
      value={format}
      options={[
        { value: "webcal", label: m.feeds_qr_webcal() },
        { value: "https", label: m.feeds_qr_https() },
      ]}
      onchange={(next) => (format = next)}
    />
    <p class="text-muted-foreground max-w-sm text-center text-xs text-pretty">
      {format === "webcal" ? m.feeds_qr_webcal_hint() : m.feeds_qr_https_hint()}
    </p>
  </div>
{/snippet}

<Dialog.Root bind:open>
  <Dialog.Content class="max-h-[calc(100svh-2rem)] overflow-y-auto">
    <Dialog.Header>
      <Dialog.Title>{m.feeds_subscribe_title()}</Dialog.Title>
      <Dialog.Description>
        {m.feeds_subscribe_description({ name: feed?.name ?? "" })}
      </Dialog.Description>
    </Dialog.Header>
    {#if https && webcal && qrValue}
      <div class="hidden sm:block">{@render qr(qrValue)}</div>
      <details class="group rounded-lg border sm:hidden">
        <summary
          class="focus-visible:ring-ring/50 flex min-h-11 cursor-pointer list-none items-center justify-between gap-2 rounded-lg px-3 py-2 text-sm font-medium outline-none focus-visible:ring-[3px]"
        >
          {m.feeds_qr_toggle()}
          <ChevronDownIcon
            class="text-muted-foreground size-4 shrink-0 transition-transform group-open:rotate-180"
            aria-hidden="true"
          />
        </summary>
        <div class="border-t p-3">{@render qr(qrValue)}</div>
      </details>
      <div class="flex flex-col gap-2">
        <label for="feed-url" class="text-sm font-medium">
          {m.feeds_url_label()}
        </label>
        <div class="flex items-stretch gap-2">
          <code
            id="feed-url"
            class="bg-muted min-w-0 flex-1 rounded-md px-3 py-2 font-mono text-xs break-all select-all"
          >
            {https}
          </code>
          <CopyButton
            value={https}
            iconOnly
            label={m.feeds_copy_url()}
            copiedMessage={m.feeds_url_copied()}
          />
        </div>
        <Button
          href={webcal}
          variant="outline"
          class="w-full sm:w-auto sm:self-start"
        >
          <CalendarPlusIcon />{m.feeds_open_in_calendar()}
        </Button>
      </div>
      <details class="group rounded-lg border">
        <summary
          class="focus-visible:ring-ring/50 flex min-h-11 cursor-pointer list-none items-center justify-between gap-2 rounded-lg px-3 py-2 text-sm font-medium outline-none focus-visible:ring-[3px]"
        >
          {m.feeds_howto_toggle()}
          <ChevronDownIcon
            class="text-muted-foreground size-4 shrink-0 transition-transform group-open:rotate-180"
            aria-hidden="true"
          />
        </summary>
        <div class="border-t px-3 py-3"><CalendarHowto compact /></div>
      </details>
    {:else}
      <Alert.Root class="border-warning/50">
        <TriangleAlertIcon class="text-warning" />
        <Alert.Title>{m.feeds_url_missing_title()}</Alert.Title>
        <Alert.Description>{m.feeds_url_missing()}</Alert.Description>
      </Alert.Root>
    {/if}
    <Dialog.Footer>
      <Button type="button" onclick={() => (open = false)}>
        {m.common_close()}
      </Button>
    </Dialog.Footer>
  </Dialog.Content>
</Dialog.Root>
