<script lang="ts">
  import LoaderCircleIcon from "@lucide/svelte/icons/loader-circle";
  import TriangleAlertIcon from "@lucide/svelte/icons/triangle-alert";
  import { toast } from "svelte-sonner";
  import { api } from "$lib/api/browser";
  import { isApiError } from "$lib/api/errors";
  import { endpoints } from "$lib/api/registry";
  import type { Integration } from "$lib/api/schemas/integrations";
  import FormAlert from "$lib/components/app/form-alert.svelte";
  import SwitchField from "$lib/components/app/switch-field.svelte";
  import Field from "$lib/components/tasks/field.svelte";
  import * as Alert from "$lib/components/ui/alert/index.js";
  import { Button } from "$lib/components/ui/button/index.js";
  import { Input } from "$lib/components/ui/input/index.js";
  import { forgetIntegrations } from "$lib/connections/connection";
  import { connectionSaveMessage } from "$lib/connections/errors";
  import { forgetPickerItems } from "$lib/connections/provider-lists";
  import {
    isHttpUrl,
    readProviderConfig,
    sameIds,
  } from "$lib/documents/config";
  import { m } from "$lib/paraglide/messages";
  import ProviderPicker from "./provider-picker.svelte";

  let {
    integration,
    onchanged,
  }: {
    integration: Integration;
    onchanged: () => Promise<void>;
  } = $props();

  const KIND = "paperless" as const;

  const stored = $derived(readProviderConfig(integration.config));

  /* The form is seeded once; saving reloads the list and `stored` follows. */
  /* svelte-ignore state_referenced_locally */
  const seed = readProviderConfig(integration.config);
  let sharedTags = $state([...seed.sharedTagIds]);
  let receiptTags = $state([...seed.receiptTagIds]);
  let manualTags = $state([...seed.manualTagIds]);
  let warrantyField = $state(
    seed.warrantyFieldId ? [seed.warrantyFieldId] : [],
  );
  let warrantyExtendedField = $state(
    seed.warrantyExtendedFieldId ? [seed.warrantyExtendedFieldId] : [],
  );
  let uploadTags = $state([...seed.uploadTagIds]);
  let uploadCorrespondent = $state(
    seed.uploadCorrespondentId ? [seed.uploadCorrespondentId] : [],
  );
  let uploadStoragePath = $state(
    seed.uploadStoragePathId ? [seed.uploadStoragePathId] : [],
  );
  let shareGroups = $state([...seed.shareGroupIds]);
  let writeBackNotes = $state(seed.writeBackNotes);
  let appUrl = $state(seed.appUrl ?? "");

  let saving = $state(false);
  let error = $state<string | undefined>();
  let fieldErrors = $state<Record<string, string>>({});

  const dateField = (item: { dataType: string | null }) =>
    item.dataType === "date";

  const dirty = $derived(
    !sameIds(sharedTags, stored.sharedTagIds) ||
      !sameIds(receiptTags, stored.receiptTagIds) ||
      !sameIds(manualTags, stored.manualTagIds) ||
      !sameIds(warrantyField, ids(stored.warrantyFieldId)) ||
      !sameIds(warrantyExtendedField, ids(stored.warrantyExtendedFieldId)) ||
      !sameIds(uploadTags, stored.uploadTagIds) ||
      !sameIds(uploadCorrespondent, ids(stored.uploadCorrespondentId)) ||
      !sameIds(uploadStoragePath, ids(stored.uploadStoragePathId)) ||
      !sameIds(shareGroups, stored.shareGroupIds) ||
      writeBackNotes !== stored.writeBackNotes ||
      appUrl.trim() !== (stored.appUrl ?? ""),
  );

  function ids(id: number | null | undefined): number[] {
    return id ? [id] : [];
  }

  function validate(): boolean {
    const found: Record<string, string> = {};
    const [first] = warrantyField;
    if (first !== undefined && first === warrantyExtendedField[0]) {
      found.warrantyExtended = m.integration_paperless_warranty_same();
    }
    if (appUrl.trim() !== "" && !isHttpUrl(appUrl.trim())) {
      found.appUrl = m.integration_ha_url_invalid();
    }
    fieldErrors = found;
    return Object.keys(found).length === 0;
  }

  async function submit(event: SubmitEvent) {
    event.preventDefault();
    if (saving || !integration.baseUrl) return;
    error = undefined;
    if (!validate()) return;
    saving = true;
    try {
      const saved = await api.call(endpoints.integrationsSave, {
        params: { kind: KIND },
        body: {
          baseUrl: integration.baseUrl,
          allowInsecureTls: integration.allowInsecureTls,
          enabled: integration.enabled,
          config: {
            sharedTagIds: sharedTags,
            receiptTagIds: receiptTags,
            manualTagIds: manualTags,
            warrantyFieldId: warrantyField[0] ?? null,
            warrantyExtendedFieldId: warrantyExtendedField[0] ?? null,
            uploadTagIds: uploadTags,
            uploadCorrespondentId: uploadCorrespondent[0] ?? null,
            uploadStoragePathId: uploadStoragePath[0] ?? null,
            shareGroupIds: shareGroups,
            writeBackNotes,
            appUrl: appUrl.trim(),
          },
        },
      });
      const config = readProviderConfig(saved.config);
      appUrl = config.appUrl ?? "";
      forgetIntegrations();
      forgetPickerItems();
      toast.success(m.integration_paperless_settings_saved());
      await onchanged();
    } catch (err) {
      error =
        isApiError(err) && err.code === "invalid_request"
          ? m.integration_paperless_settings_invalid()
          : connectionSaveMessage(err, integration.baseUrl);
    } finally {
      saving = false;
    }
  }

  const pickersDisabled = $derived(!integration.enabled);

  /* One failed read concerns every picker (same connection), so the form says it once. */
  let listErrors = $state<Record<string, string>>({});
  let reloadKey = $state(0);
  const listError = $derived(Object.values(listErrors)[0]);

  function onListError(id: string, message: string | undefined) {
    if (message === undefined) delete listErrors[id];
    else listErrors[id] = message;
  }

  function retryLists() {
    forgetPickerItems();
    listErrors = {};
    reloadKey += 1;
  }
</script>

<form class="flex flex-col gap-6 border-t pt-5" onsubmit={submit} novalidate>
  <div class="flex flex-col gap-1">
    <h3 class="text-base font-semibold">
      {m.integration_paperless_settings_title()}
    </h3>
    <p class="text-muted-foreground text-sm text-pretty">
      {pickersDisabled
        ? m.integration_paperless_settings_paused()
        : m.integration_paperless_settings_description()}
    </p>
  </div>

  <FormAlert message={error} />

  {#if listError}
    <Alert.Root variant="destructive" class="border-destructive/40">
      <TriangleAlertIcon />
      <Alert.Description class="flex flex-col items-start gap-2 text-pretty">
        <span
          >{m.integration_paperless_lists_failed({ reason: listError })}</span
        >
        <Button type="button" variant="outline" size="sm" onclick={retryLists}>
          {m.common_retry()}
        </Button>
      </Alert.Description>
    </Alert.Root>
  {/if}

  {#key reloadKey}
    <section class="flex flex-col gap-5" aria-labelledby="pl-known-title">
      <h4 id="pl-known-title" class="text-sm font-medium">
        {m.integration_paperless_group_known()}
      </h4>
      <Field
        id="pl-shared-tags"
        label={m.integration_paperless_shared_tags()}
        hint={m.integration_paperless_shared_tags_hint()}
        optional
      >
        {#snippet children({ describedby })}
          <ProviderPicker
            id="pl-shared-tags"
            kind={KIND}
            source="tags"
            bind:value={sharedTags}
            placeholder={m.integration_paperless_pick_tags()}
            searchPlaceholder={m.integration_paperless_search_tags()}
            disabled={pickersDisabled}
            onlisterror={onListError}
            {describedby}
          />
        {/snippet}
      </Field>
      <Field
        id="pl-receipt-tags"
        label={m.integration_paperless_receipt_tags()}
        hint={m.integration_paperless_receipt_tags_hint()}
        optional
      >
        {#snippet children({ describedby })}
          <ProviderPicker
            id="pl-receipt-tags"
            kind={KIND}
            source="tags"
            bind:value={receiptTags}
            placeholder={m.integration_paperless_pick_tags()}
            searchPlaceholder={m.integration_paperless_search_tags()}
            disabled={pickersDisabled}
            onlisterror={onListError}
            {describedby}
          />
        {/snippet}
      </Field>
      <Field
        id="pl-manual-tags"
        label={m.integration_paperless_manual_tags()}
        hint={m.integration_paperless_manual_tags_hint()}
        optional
      >
        {#snippet children({ describedby })}
          <ProviderPicker
            id="pl-manual-tags"
            kind={KIND}
            source="tags"
            bind:value={manualTags}
            placeholder={m.integration_paperless_pick_tags()}
            searchPlaceholder={m.integration_paperless_search_tags()}
            disabled={pickersDisabled}
            onlisterror={onListError}
            {describedby}
          />
        {/snippet}
      </Field>
    </section>

    <section class="flex flex-col gap-5" aria-labelledby="pl-warranty-title">
      <h4 id="pl-warranty-title" class="text-sm font-medium">
        {m.integration_paperless_group_warranty()}
      </h4>
      <Field
        id="pl-warranty-field"
        label={m.integration_paperless_warranty_field()}
        hint={m.integration_paperless_warranty_field_hint()}
        optional
      >
        {#snippet children({ describedby })}
          <ProviderPicker
            id="pl-warranty-field"
            kind={KIND}
            source="custom-fields"
            bind:value={warrantyField}
            max={1}
            filter={dateField}
            placeholder={m.integration_paperless_pick_field()}
            searchPlaceholder={m.integration_paperless_search_fields()}
            disabled={pickersDisabled}
            onlisterror={onListError}
            {describedby}
          />
        {/snippet}
      </Field>
      <Field
        id="pl-warranty-extended-field"
        label={m.integration_paperless_warranty_extended_field()}
        hint={m.integration_paperless_warranty_extended_field_hint()}
        optional
        error={fieldErrors.warrantyExtended}
      >
        {#snippet children({ describedby, invalid })}
          <ProviderPicker
            id="pl-warranty-extended-field"
            kind={KIND}
            source="custom-fields"
            bind:value={warrantyExtendedField}
            max={1}
            filter={dateField}
            placeholder={m.integration_paperless_pick_field()}
            searchPlaceholder={m.integration_paperless_search_fields()}
            disabled={pickersDisabled}
            onlisterror={onListError}
            {invalid}
            {describedby}
          />
        {/snippet}
      </Field>
    </section>

    <section class="flex flex-col gap-5" aria-labelledby="pl-upload-title">
      <h4 id="pl-upload-title" class="text-sm font-medium">
        {m.integration_paperless_group_upload()}
      </h4>
      <Field
        id="pl-upload-tags"
        label={m.integration_paperless_upload_tags()}
        hint={m.integration_paperless_upload_tags_hint()}
        optional
      >
        {#snippet children({ describedby })}
          <ProviderPicker
            id="pl-upload-tags"
            kind={KIND}
            source="tags"
            bind:value={uploadTags}
            placeholder={m.integration_paperless_pick_tags()}
            searchPlaceholder={m.integration_paperless_search_tags()}
            disabled={pickersDisabled}
            onlisterror={onListError}
            {describedby}
          />
        {/snippet}
      </Field>
      <Field
        id="pl-upload-correspondent"
        label={m.integration_paperless_upload_correspondent()}
        optional
      >
        {#snippet children({ describedby })}
          <ProviderPicker
            id="pl-upload-correspondent"
            kind={KIND}
            source="correspondents"
            bind:value={uploadCorrespondent}
            max={1}
            placeholder={m.integration_paperless_pick_correspondent()}
            searchPlaceholder={m.integration_paperless_search_correspondents()}
            disabled={pickersDisabled}
            onlisterror={onListError}
            {describedby}
          />
        {/snippet}
      </Field>
      <Field
        id="pl-upload-storage-path"
        label={m.integration_paperless_upload_storage_path()}
        optional
      >
        {#snippet children({ describedby })}
          <ProviderPicker
            id="pl-upload-storage-path"
            kind={KIND}
            source="storage-paths"
            bind:value={uploadStoragePath}
            max={1}
            placeholder={m.integration_paperless_pick_storage_path()}
            searchPlaceholder={m.integration_paperless_search_storage_paths()}
            disabled={pickersDisabled}
            onlisterror={onListError}
            {describedby}
          />
        {/snippet}
      </Field>
      <Field
        id="pl-share-groups"
        label={m.integration_paperless_share_groups()}
        hint={m.integration_paperless_share_groups_hint()}
        optional
      >
        {#snippet children({ describedby })}
          <ProviderPicker
            id="pl-share-groups"
            kind={KIND}
            source="groups"
            bind:value={shareGroups}
            placeholder={m.integration_paperless_pick_groups()}
            searchPlaceholder={m.integration_paperless_search_groups()}
            disabled={pickersDisabled}
            onlisterror={onListError}
            {describedby}
          />
        {/snippet}
      </Field>
    </section>

    <section class="flex flex-col gap-5" aria-labelledby="pl-notes-title">
      <h4 id="pl-notes-title" class="text-sm font-medium">
        {m.integration_paperless_group_notes()}
      </h4>
      <SwitchField
        id="pl-write-back"
        bind:checked={writeBackNotes}
        label={m.integration_paperless_write_back()}
        hint={m.integration_paperless_write_back_hint()}
      />
      <Field
        id="pl-app-url"
        label={m.integration_ha_app_url()}
        hint={m.integration_paperless_app_url_hint()}
        optional
        error={fieldErrors.appUrl}
      >
        {#snippet children({ describedby, invalid })}
          <Input
            id="pl-app-url"
            type="url"
            inputmode="url"
            class="h-10"
            autocomplete="off"
            autocapitalize="none"
            spellcheck={false}
            placeholder="https://hauswart.example.org"
            bind:value={appUrl}
            aria-invalid={invalid || undefined}
            aria-describedby={describedby}
          />
        {/snippet}
      </Field>
    </section>
  {/key}

  <div class="flex flex-wrap items-center gap-2">
    <Button type="submit" disabled={saving || !dirty}>
      {#if saving}
        <LoaderCircleIcon class="animate-spin" />{m.common_saving()}
      {:else}
        {m.integration_paperless_settings_save()}
      {/if}
    </Button>
  </div>
</form>
