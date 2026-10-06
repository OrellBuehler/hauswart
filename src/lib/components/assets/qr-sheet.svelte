<script lang="ts">
  import { resolve } from "$app/paths";
  import ArrowLeftIcon from "@lucide/svelte/icons/arrow-left";
  import PrinterIcon from "@lucide/svelte/icons/printer";
  import QrCodeIcon from "@lucide/svelte/icons/qr-code";
  import type { Asset } from "$lib/api/schemas/assets";
  import { qrLink } from "$lib/assets/links";
  import EmptyState from "$lib/components/app/empty-state.svelte";
  import { Button } from "$lib/components/ui/button/index.js";
  import { m } from "$lib/paraglide/messages";
  import QrCode from "./qr-code.svelte";

  let {
    title,
    assets,
    origin,
    backHref,
    backLabel,
    showRoom = false,
  }: {
    title: string;
    assets: Asset[];
    origin: string;
    backHref: string;
    backLabel: string;
    /** Prints the room under each name; for sheets that span rooms. */
    showRoom?: boolean;
  } = $props();
</script>

<div class="flex flex-col gap-6">
  <div class="flex flex-col gap-4 print:hidden">
    <Button
      href={backHref}
      variant="ghost"
      size="sm"
      class="text-muted-foreground -ms-2 w-fit"
    >
      <ArrowLeftIcon />{backLabel}
    </Button>
    <header class="flex flex-wrap items-end justify-between gap-x-4 gap-y-3">
      <div class="min-w-0">
        <h1
          class="text-2xl font-semibold tracking-tight text-balance md:text-3xl"
        >
          {title}
        </h1>
        <p class="text-muted-foreground mt-1 text-sm text-pretty">
          {m.qr_sheet_description({ count: assets.length })}
        </p>
      </div>
      <Button onclick={() => window.print()} disabled={assets.length === 0}>
        <PrinterIcon />{m.qr_print()}
      </Button>
    </header>
  </div>

  {#if assets.length === 0}
    <EmptyState
      icon={QrCodeIcon}
      title={m.qr_sheet_empty_title()}
      description={m.qr_sheet_empty_body()}
    >
      {#snippet actions()}
        <Button href={resolve("/assets/new")} variant="outline">
          {m.inventory_create()}
        </Button>
      {/snippet}
    </EmptyState>
  {:else}
    <h1 class="hidden text-lg font-semibold print:block print:text-black">
      {title}
    </h1>
    <ul
      class="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 print:grid-cols-3 print:gap-4"
    >
      {#each assets as asset (asset.id)}
        <li
          class="bg-card flex break-inside-avoid flex-col items-center gap-2 rounded-xl border p-3 text-center print:rounded-none print:border-black/30 print:bg-white print:text-black"
        >
          <QrCode
            value={qrLink(origin, asset.qrSlug)}
            label={m.qr_aria({ name: asset.name })}
            class="w-full max-w-44 border print:border-0"
          />
          <div class="max-w-full min-w-0">
            <p class="truncate text-sm font-semibold">{asset.name}</p>
            {#if showRoom && asset.roomName}
              <p
                class="text-muted-foreground truncate text-xs print:text-black/70"
              >
                {asset.roomName}
              </p>
            {/if}
            <p
              class="text-muted-foreground mt-0.5 truncate font-mono text-[10px] print:text-black/60"
            >
              /d/{asset.qrSlug}
            </p>
          </div>
        </li>
      {/each}
    </ul>
  {/if}
</div>
