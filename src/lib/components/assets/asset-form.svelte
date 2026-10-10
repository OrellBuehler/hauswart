<script lang="ts">
  import { goto } from "$app/navigation";
  import { resolve } from "$app/paths";
  import FileCheckIcon from "@lucide/svelte/icons/file-check";
  import LoaderCircleIcon from "@lucide/svelte/icons/loader-circle";
  import { toast } from "svelte-sonner";
  import { api } from "$lib/api/browser";
  import { ASSET_KINDS, type AssetKind } from "$lib/api/enums";
  import { endpoints } from "$lib/api/registry";
  import type { Asset } from "$lib/api/schemas/assets";
  import type { Room } from "$lib/api/schemas/rooms";
  import { kindLabels } from "$lib/assets/kinds";
  import FormAlert from "$lib/components/app/form-alert.svelte";
  import { Button } from "$lib/components/ui/button/index.js";
  import { Checkbox } from "$lib/components/ui/checkbox/index.js";
  import * as Card from "$lib/components/ui/card/index.js";
  import { Input } from "$lib/components/ui/input/index.js";
  import { Label } from "$lib/components/ui/label/index.js";
  import { Switch } from "$lib/components/ui/switch/index.js";
  import { Textarea } from "$lib/components/ui/textarea/index.js";
  import { apiErrorMessage } from "$lib/error-message";
  import { m } from "$lib/paraglide/messages";
  import { cn } from "$lib/utils";
  import OptionSelect from "./option-select.svelte";
  import RoomPicker from "./room-picker.svelte";

  let {
    rooms,
    asset,
    initialKind = "device",
    initialRoomId = null,
    today,
  }: {
    rooms: Room[];
    /** The asset to edit; undefined creates a new one. */
    asset?: Asset;
    initialKind?: AssetKind;
    initialRoomId?: string | null;
    /** Household "today", the start of a new watering plan. */
    today: string;
  } = $props();

  /* The form is seeded once from its props; the page remounts it per asset. */
  /* svelte-ignore state_referenced_locally */
  const seed = asset;
  /* svelte-ignore state_referenced_locally */
  let kind = $state<AssetKind>(seed?.kind ?? initialKind);
  /* svelte-ignore state_referenced_locally */
  let roomId = $state<string | null>(seed ? seed.roomId : initialRoomId);
  let name = $state(seed?.name ?? "");
  let category = $state(seed?.category ?? "");
  let manufacturer = $state(seed?.manufacturer ?? "");
  let model = $state(seed?.model ?? "");
  let serialNumber = $state(seed?.serialNumber ?? "");
  let purchaseDate = $state(seed?.purchaseDate ?? "");
  let installedDate = $state(seed?.installedDate ?? "");
  let warrantyUntil = $state(seed?.warrantyUntil ?? "");
  let warrantyExtendedUntil = $state(seed?.warrantyExtendedUntil ?? "");
  let showOnEmergency = $state(seed?.showOnEmergency ?? false);
  let notes = $state(seed?.notes ?? "");
  let species = $state(seed?.species ?? "");
  let light = $state(seed?.light ?? "");
  let waterNotes = $state(seed?.waterNotes ?? "");

  let makePlan = $state(true);
  let everyDays = $state(7);
  let seasonal = $state(false);
  let summerEveryDays = $state(3);

  let pending = $state(false);
  let error = $state<string | undefined>();

  const editing = $derived(asset !== undefined);
  const isPlant = $derived(kind === "plant");
  const kindOptions = ASSET_KINDS.map((value) => ({
    value,
    label: kindLabels[value](),
  }));
  const backHref = $derived(
    asset
      ? resolve(`/assets/${asset.id}`)
      : isPlant
        ? resolve("/plants")
        : resolve("/inventory"),
  );

  const optionalDate = (value: string) => (value === "" ? null : value);

  function validInterval(value: number) {
    return Number.isInteger(value) && value >= 1 && value <= 3650;
  }

  async function submit(event: SubmitEvent) {
    event.preventDefault();
    if (pending) return;
    const plan = !editing && isPlant && makePlan;
    if (
      plan &&
      (!validInterval(everyDays) ||
        (seasonal && !validInterval(summerEveryDays)))
    ) {
      error = m.asset_form_interval_invalid();
      return;
    }
    pending = true;
    error = undefined;
    let saved: Asset | undefined;
    try {
      const body = {
        kind,
        name,
        roomId,
        category,
        manufacturer,
        model,
        serialNumber,
        purchaseDate: optionalDate(purchaseDate),
        installedDate: optionalDate(installedDate),
        warrantyUntil: optionalDate(warrantyUntil),
        warrantyExtendedUntil: optionalDate(warrantyExtendedUntil),
        showOnEmergency,
        notes,
        species,
        light,
        waterNotes,
      };
      saved = asset
        ? await api.call(endpoints.assetsUpdate, {
            params: { id: asset.id },
            body,
          })
        : await api.call(endpoints.assetsCreate, { body });

      if (plan) {
        try {
          await api.call(endpoints.tasksCreate, {
            body: {
              title: m.asset_form_plan_task_title({ name: saved.name }),
              category: "plant",
              assetId: saved.id,
              trigger: {
                v: 1,
                type: "interval",
                every: everyDays,
                unit: "day",
                anchor: "completion",
                startDate: today,
                ...(seasonal
                  ? {
                      seasons: [
                        {
                          fromMonth: 4,
                          toMonth: 9,
                          every: summerEveryDays,
                          unit: "day" as const,
                        },
                      ],
                    }
                  : {}),
              },
            },
          });
        } catch (err) {
          toast.error(
            m.asset_form_plan_failed({ error: apiErrorMessage(err) }),
          );
          await goto(resolve(`/assets/${saved.id}`));
          return;
        }
      }
      toast.success(
        editing
          ? m.asset_saved_toast({ name: saved.name })
          : m.asset_created_toast({ name: saved.name }),
      );
      await goto(resolve(`/assets/${saved.id}`));
    } catch (err) {
      error = apiErrorMessage(err, { conflict: m.asset_error_name_taken() });
    } finally {
      pending = false;
    }
  }
</script>

<form class="flex flex-col gap-6" onsubmit={submit}>
  <Card.Root>
    <Card.Header>
      <Card.Title>{m.asset_form_general()}</Card.Title>
    </Card.Header>
    <Card.Content class="grid grid-cols-1 gap-5 sm:grid-cols-2">
      <div class="flex flex-col gap-2 sm:col-span-2">
        <Label for="asset-name">{m.asset_name()}</Label>
        <Input
          class="h-10"
          id="asset-name"
          autocomplete="off"
          required
          maxlength={120}
          bind:value={name}
        />
      </div>
      <div class="flex flex-col gap-2">
        <Label for="asset-kind">{m.asset_kind()}</Label>
        <OptionSelect
          id="asset-kind"
          options={kindOptions}
          bind:value={
            () => kind,
            (next) => {
              if (next) kind = next;
            }
          }
        />
      </div>
      <div class="flex flex-col gap-2">
        <Label for="asset-room">{m.asset_room()}</Label>
        <RoomPicker
          id="asset-room"
          {rooms}
          bind:value={roomId}
          noneLabel={m.asset_no_room()}
        />
      </div>
      {#if !isPlant}
        <div class="flex flex-col gap-2 sm:col-span-2">
          <Label for="asset-category">
            {m.asset_category()}
            <span class="text-muted-foreground font-normal"
              >{m.common_optional()}</span
            >
          </Label>
          <Input
            class="h-10"
            id="asset-category"
            autocomplete="off"
            maxlength={64}
            placeholder={m.asset_category_placeholder()}
            bind:value={category}
          />
        </div>
      {/if}
    </Card.Content>
  </Card.Root>

  {#if isPlant}
    <Card.Root>
      <Card.Header>
        <Card.Title>{m.asset_form_care()}</Card.Title>
      </Card.Header>
      <Card.Content class="grid grid-cols-1 gap-5 sm:grid-cols-2">
        <div class="flex flex-col gap-2">
          <Label for="asset-species">{m.asset_species()}</Label>
          <Input
            class="h-10"
            id="asset-species"
            autocomplete="off"
            maxlength={120}
            bind:value={species}
          />
        </div>
        <div class="flex flex-col gap-2">
          <Label for="asset-light">{m.asset_light()}</Label>
          <Input
            class="h-10"
            id="asset-light"
            autocomplete="off"
            maxlength={120}
            placeholder={m.asset_light_placeholder()}
            bind:value={light}
          />
        </div>
        <div class="flex flex-col gap-2 sm:col-span-2">
          <Label for="asset-water-notes">{m.asset_water_notes()}</Label>
          <Textarea
            id="asset-water-notes"
            rows={2}
            maxlength={2000}
            bind:value={waterNotes}
          />
        </div>
      </Card.Content>
    </Card.Root>

    {#if !editing}
      <Card.Root>
        <Card.Header>
          <Card.Title>{m.asset_form_plan()}</Card.Title>
          <Card.Description>{m.asset_form_plan_description()}</Card.Description>
        </Card.Header>
        <Card.Content class="flex flex-col gap-5">
          <div class="flex items-center gap-3">
            <Switch id="plan-enabled" bind:checked={makePlan} />
            <Label for="plan-enabled" class="font-normal">
              {m.asset_form_plan_enable()}
            </Label>
          </div>
          {#if makePlan}
            <div class="grid grid-cols-1 gap-5 sm:grid-cols-2">
              <div class="flex flex-col gap-2">
                <Label for="plan-every">{m.asset_form_plan_every()}</Label>
                <Input
                  class="h-10"
                  id="plan-every"
                  type="number"
                  inputmode="numeric"
                  min={1}
                  max={365}
                  required
                  bind:value={everyDays}
                />
                <p class="text-muted-foreground text-xs">
                  {seasonal
                    ? m.asset_form_plan_every_winter()
                    : m.asset_form_plan_every_year()}
                </p>
              </div>
              <div class="flex flex-col gap-2 sm:justify-end">
                <div class="flex items-center gap-2 sm:h-9">
                  <Checkbox
                    id="plan-seasonal"
                    class="size-5"
                    bind:checked={seasonal}
                  />
                  <Label for="plan-seasonal" class="font-normal">
                    {m.asset_form_plan_seasonal()}
                  </Label>
                </div>
              </div>
              {#if seasonal}
                <div class="flex flex-col gap-2">
                  <Label for="plan-summer">{m.asset_form_plan_summer()}</Label>
                  <Input
                    class="h-10"
                    id="plan-summer"
                    type="number"
                    inputmode="numeric"
                    min={1}
                    max={365}
                    required
                    bind:value={summerEveryDays}
                  />
                  <p class="text-muted-foreground text-xs">
                    {m.asset_form_plan_summer_hint()}
                  </p>
                </div>
              {/if}
            </div>
          {/if}
        </Card.Content>
      </Card.Root>
    {/if}
  {:else}
    <Card.Root>
      <Card.Header>
        <Card.Title>{m.asset_form_device()}</Card.Title>
      </Card.Header>
      <Card.Content class="grid grid-cols-1 gap-5 sm:grid-cols-2">
        <div class="flex flex-col gap-2">
          <Label for="asset-manufacturer">{m.asset_manufacturer()}</Label>
          <Input
            class="h-10"
            id="asset-manufacturer"
            autocomplete="off"
            maxlength={120}
            bind:value={manufacturer}
          />
        </div>
        <div class="flex flex-col gap-2">
          <Label for="asset-model">{m.asset_model()}</Label>
          <Input
            class="h-10"
            id="asset-model"
            autocomplete="off"
            maxlength={120}
            bind:value={model}
          />
        </div>
        <div class="flex flex-col gap-2 sm:col-span-2">
          <Label for="asset-serial">{m.asset_serial()}</Label>
          <Input
            class="h-10"
            id="asset-serial"
            autocomplete="off"
            autocapitalize="characters"
            spellcheck={false}
            maxlength={120}
            bind:value={serialNumber}
          />
        </div>
      </Card.Content>
    </Card.Root>

    <Card.Root>
      <Card.Header>
        <Card.Title>{m.asset_form_purchase()}</Card.Title>
      </Card.Header>
      <Card.Content class="grid grid-cols-1 gap-5 sm:grid-cols-2">
        <div class="flex flex-col gap-2">
          <Label for="asset-purchase">{m.asset_purchase_date()}</Label>
          <Input
            class="h-10"
            id="asset-purchase"
            type="date"
            bind:value={purchaseDate}
          />
        </div>
        <div class="flex flex-col gap-2">
          <Label for="asset-installed">{m.asset_installed_date()}</Label>
          <Input
            class="h-10"
            id="asset-installed"
            type="date"
            bind:value={installedDate}
          />
        </div>
        <div class="flex flex-col gap-2">
          <Label for="asset-warranty">{m.asset_warranty_until()}</Label>
          <Input
            class="h-10"
            id="asset-warranty"
            type="date"
            bind:value={warrantyUntil}
          />
        </div>
        <div class="flex flex-col gap-2">
          <Label for="asset-warranty-ext">{m.asset_warranty_extended()}</Label>
          <Input
            class="h-10"
            id="asset-warranty-ext"
            type="date"
            bind:value={warrantyExtendedUntil}
          />
          <p class="text-muted-foreground text-xs">
            {m.asset_warranty_extended_hint()}
          </p>
        </div>
        {#if seed?.warrantySource === "document"}
          <p
            class="text-muted-foreground flex items-start gap-2 text-xs text-pretty sm:col-span-2"
          >
            <FileCheckIcon
              class="mt-0.5 size-3.5 shrink-0"
              aria-hidden="true"
            />
            {m.asset_warranty_from_document_hint()}
          </p>
        {/if}
      </Card.Content>
    </Card.Root>
  {/if}

  <Card.Root>
    <Card.Header>
      <Card.Title>{m.asset_form_more()}</Card.Title>
    </Card.Header>
    <Card.Content class="flex flex-col gap-5">
      <div class="flex flex-col gap-2">
        <Label for="asset-notes">
          {m.asset_notes()}
          <span class="text-muted-foreground font-normal"
            >{m.common_optional()}</span
          >
        </Label>
        <Textarea
          id="asset-notes"
          rows={4}
          maxlength={50000}
          bind:value={notes}
        />
      </div>
      <div class="flex items-start gap-3">
        <Switch
          id="asset-emergency"
          class="mt-0.5"
          bind:checked={showOnEmergency}
        />
        <div class="flex flex-col gap-1">
          <Label for="asset-emergency" class="font-normal">
            {m.asset_emergency()}
          </Label>
          <p class="text-muted-foreground text-xs">
            {m.asset_emergency_hint()}
          </p>
        </div>
      </div>
    </Card.Content>
  </Card.Root>

  <div
    class="bg-background/90 sticky bottom-0 z-10 -mx-4 flex flex-col gap-3 border-t px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] backdrop-blur md:-mx-8 md:px-8"
  >
    <FormAlert message={error} />
    <div class="flex justify-end gap-2">
      <Button
        href={backHref}
        variant="outline"
        size="lg"
        class={cn(
          "flex-1 sm:flex-none",
          pending && "pointer-events-none opacity-50",
        )}
      >
        {m.common_cancel()}
      </Button>
      <Button
        type="submit"
        size="lg"
        class="flex-1 sm:flex-none"
        disabled={pending}
      >
        {#if pending}
          <LoaderCircleIcon class="animate-spin" />{m.common_saving()}
        {:else if editing}
          {m.common_save()}
        {:else}
          {m.common_create()}
        {/if}
      </Button>
    </div>
  </div>
</form>
