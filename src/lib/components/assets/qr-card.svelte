<script lang="ts">
  import { resolve } from "$app/paths";
  import PrinterIcon from "@lucide/svelte/icons/printer";
  import type { Asset } from "$lib/api/schemas/assets";
  import { qrLink } from "$lib/assets/links";
  import CopyButton from "$lib/components/app/copy-button.svelte";
  import { Button } from "$lib/components/ui/button/index.js";
  import * as Card from "$lib/components/ui/card/index.js";
  import { m } from "$lib/paraglide/messages";
  import QrCode from "./qr-code.svelte";

  let { asset, origin }: { asset: Asset; origin: string } = $props();

  const link = $derived(qrLink(origin, asset.qrSlug));
</script>

<Card.Root class="print:border-0 print:shadow-none">
  <Card.Header class="print:hidden">
    <Card.Title>{m.qr_title()}</Card.Title>
    <Card.Description>{m.qr_description()}</Card.Description>
  </Card.Header>
  <Card.Content class="flex flex-col items-center gap-4">
    <QrCode
      value={link}
      label={m.qr_aria({ name: asset.name })}
      class="max-w-48 border print:max-w-96 print:border-0"
    />
    <div class="hidden text-center print:block">
      <p class="text-2xl font-semibold">{asset.name}</p>
      {#if asset.roomName}<p class="text-lg">{asset.roomName}</p>{/if}
    </div>
    <p
      class="text-muted-foreground max-w-full text-center font-mono text-xs break-all"
    >
      {link}
    </p>
    <div class="flex flex-wrap justify-center gap-2 print:hidden">
      <Button variant="outline" size="sm" onclick={() => window.print()}>
        <PrinterIcon />{m.qr_print()}
      </Button>
      <CopyButton
        value={link}
        label={m.qr_copy_link()}
        copiedMessage={m.common_copied()}
      />
    </div>
    {#if asset.roomId}
      <Button
        href={resolve(`/rooms/${asset.roomId}/qr`)}
        variant="link"
        size="sm"
        class="print:hidden"
      >
        {m.qr_room_sheet()}
      </Button>
    {/if}
  </Card.Content>
</Card.Root>
