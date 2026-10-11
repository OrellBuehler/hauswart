<script lang="ts">
  import { resolve } from "$app/paths";
  import { toast } from "svelte-sonner";
  import { invalidateAll } from "$app/navigation";
  import { api } from "$lib/api/browser";
  import { loadHousehold } from "$lib/api/household";
  import { endpoints } from "$lib/api/registry";
  import type { TireSet } from "$lib/api/schemas/tire-sets";
  import FormDialog from "$lib/components/app/form-dialog.svelte";
  import Field from "$lib/components/tasks/field.svelte";
  import OptionSelect from "$lib/components/tasks/option-select.svelte";
  import { Input } from "$lib/components/ui/input/index.js";
  import { apiErrorMessage } from "$lib/error-message";
  import { gotoFromOverlay } from "$lib/overlays/use-overlay-history.svelte";
  import { m } from "$lib/paraglide/messages";
  import { apiFieldErrors } from "$lib/tasks/field-errors";
  import { refusedMessage, refusedReading } from "$lib/vehicles/odometer-error";
  import { VehicleReading } from "$lib/vehicles/odometer-state.svelte";
  import { buildMount } from "$lib/vehicles/tire-form";
  import { setMake, setTitle } from "$lib/vehicles/tire-label";
  import { tireOffers } from "$lib/vehicles/tire-offer.svelte";
  import { mountableSets, mountedSet } from "$lib/vehicles/tire-view";
  import OdometerReadingField from "./odometer-reading-field.svelte";

  const offer = $derived(tireOffers.current);
  const vehicle = new VehicleReading();

  let open = $state(false);
  let sets = $state.raw<TireSet[]>([]);
  let selectedId = $state("");
  let today = $state("");
  let date = $state("");
  let odometer = $state("");
  let errors = $state<Record<string, string>>({});

  const choices = $derived(mountableSets(sets));
  const options = $derived(
    choices.map((set) => ({
      value: set.id,
      label: [setTitle(set), setMake(set)].filter(Boolean).join(" · "),
    })),
  );
  const selected = $derived(choices.find((set) => set.id === selectedId));

  $effect(() => {
    const current = offer;
    if (!current) {
      open = false;
      return;
    }
    let cancelled = false;
    let stopReading: (() => void) | undefined;
    (async () => {
      const asset = await api.call(endpoints.assetsGet, {
        params: { id: current.assetId },
      });
      if (asset.kind !== "vehicle") return tireOffers.dismiss();
      const [list, household] = await Promise.all([
        api.call(endpoints.tireSetsList, {
          params: { id: current.assetId },
          query: { limit: 200 },
        }),
        loadHousehold(api),
      ]);
      if (cancelled) return;
      stopReading = vehicle.load(current.assetId);
      today = household.today;
      const onVehicle = mountedSet(list.items);
      if (current.season && onVehicle?.season === current.season) {
        return tireOffers.dismiss();
      }
      sets = list.items;
      const candidates = mountableSets(list.items);
      selectedId =
        (
          candidates.find((set) => set.season === current.season) ??
          candidates[0]
        )?.id ?? "";
      date = today;
      odometer = "";
      errors = {};
      open = true;
    })().catch((err) => {
      if (cancelled) return;
      toast.error(apiErrorMessage(err));
      tireOffers.dismiss();
    });
    return () => {
      cancelled = true;
      stopReading?.();
    };
  });

  async function submit(): Promise<string | void> {
    if (!offer) return;
    if (!selected) {
      await gotoFromOverlay(resolve(`/assets/${offer.assetId}` as "/"));
      return;
    }
    const built = buildMount({
      date,
      odometer,
      known: vehicle.known,
      today,
    });
    errors = built.errors;
    if (!built.body) return m.form_check_fields();
    try {
      await api.call(endpoints.tireSetsMount, {
        params: { id: offer.assetId, setId: selected.id },
        body: built.body,
      });
      toast.success(m.tire_mounted_toast({ name: setTitle(selected) }));
      await invalidateAll();
    } catch (err) {
      const refused = refusedReading(err, "odometer");
      if (refused) {
        errors = { odometer: refusedMessage(refused, vehicle.unit) };
        return m.form_check_fields();
      }
      errors = apiFieldErrors(err);
      if (Object.keys(errors).length > 0) return m.form_check_fields();
      return apiErrorMessage(err, { conflict: m.tire_error_not_mountable() });
    }
  }
</script>

{#if offer}
  <FormDialog
    bind:open={
      () => open,
      (value) => {
        open = value;
        if (!value) tireOffers.dismiss();
      }
    }
    title={m.tire_offer_title()}
    description={m.tire_offer_description({ title: offer.taskTitle })}
    submitLabel={selected ? m.tire_mount_submit() : m.tire_offer_to_vehicle()}
    pendingLabel={m.tire_mount_pending()}
    onsubmit={submit}
  >
    {#if selected}
      <Field id="tire-offer-set" label={m.tire_offer_set()}>
        {#snippet children({ describedby })}
          <OptionSelect
            id="tire-offer-set"
            {options}
            bind:value={selectedId}
            {describedby}
          />
        {/snippet}
      </Field>
      <Field
        id="tire-offer-date"
        label={m.tire_mount_date()}
        error={errors.date}
      >
        {#snippet children({ describedby, invalid })}
          <Input
            id="tire-offer-date"
            class="h-10"
            type="date"
            max={today}
            required
            aria-invalid={invalid || undefined}
            aria-describedby={describedby}
            bind:value={date}
          />
        {/snippet}
      </Field>
      <OdometerReadingField
        id="tire-offer-odometer"
        vehicle={vehicle.state}
        bind:value={odometer}
        error={errors.odometer}
        enterkeyhint="done"
      />
    {:else}
      <p class="text-sm text-pretty">{m.tire_offer_none()}</p>
    {/if}
  </FormDialog>
{/if}
