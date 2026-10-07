<script lang="ts">
  import { page } from "$app/state";
  import { goto } from "$app/navigation";
  import CheckIcon from "@lucide/svelte/icons/check";
  import ContactIcon from "@lucide/svelte/icons/contact";
  import EyeOffIcon from "@lucide/svelte/icons/eye-off";
  import FileSearchIcon from "@lucide/svelte/icons/file-search";
  import LoaderCircleIcon from "@lucide/svelte/icons/loader-circle";
  import RotateCcwIcon from "@lucide/svelte/icons/rotate-ccw";
  import { toast } from "svelte-sonner";
  import { api } from "$lib/api/browser";
  import type { DocumentProviderKind } from "$lib/api/enums";
  import { endpoints } from "$lib/api/registry";
  import type { z } from "zod";
  import type {
    assetSuggestionSchema,
    contactSuggestionSchema,
  } from "$lib/api/schemas/documents";
  import EmptyState from "$lib/components/app/empty-state.svelte";
  import { Button } from "$lib/components/ui/button/index.js";
  import * as Sheet from "$lib/components/ui/sheet/index.js";
  import { pickerErrorMessage } from "$lib/connections/errors";
  import {
    loadDismissedSuggestions,
    saveDismissedSuggestions,
  } from "$lib/documents/dismissed";
  import { apiErrorMessage } from "$lib/error-message";
  import { formatDay } from "$lib/format";
  import { assetHref, contactHref } from "$lib/links";
  import { m } from "$lib/paraglide/messages";

  type AssetSuggestion = z.infer<typeof assetSuggestionSchema>;
  type ContactSuggestion = z.infer<typeof contactSuggestionSchema>;
  type Suggestion = AssetSuggestion | ContactSuggestion;

  let {
    open = $bindable(false),
    kind,
    provider,
    onadded,
  }: {
    open?: boolean;
    kind: "asset" | "contact";
    /** The document system the suggestions come from. */
    provider: DocumentProviderKind;
    /** Called after something was created, to refresh the list behind the sheet. */
    onadded: () => Promise<void> | void;
  } = $props();

  let suggestions = $state.raw<Suggestion[]>([]);
  let loading = $state(false);
  let loadError = $state<string | undefined>();
  let dismissed = $state<string[]>([]);
  let showDismissed = $state(false);
  let busy = $state<Record<string, boolean>>({});
  let rowError = $state<Record<string, string>>({});
  let sequence = 0;

  const keyOf = (s: Suggestion) =>
    s.kind === "asset"
      ? `asset:${s.provider}:${s.externalId}`
      : `contact:${s.provider}:${s.correspondentId}`;

  async function load() {
    const ticket = ++sequence;
    loading = true;
    loadError = undefined;
    try {
      const result = await api.call(endpoints.documentsSuggestions, {
        query: { kind },
      });
      if (ticket !== sequence) return;
      suggestions = result.items.filter((item) => item.kind === kind);
    } catch (err) {
      if (ticket !== sequence) return;
      loadError = pickerErrorMessage(err, provider);
    } finally {
      if (ticket === sequence) loading = false;
    }
  }

  $effect(() => {
    if (!open) return;
    dismissed = loadDismissedSuggestions(page.data.user.id);
    showDismissed = false;
    rowError = {};
    void load();
  });

  const visible = $derived(
    suggestions.filter((s) => !dismissed.includes(keyOf(s))),
  );
  const ignored = $derived(
    suggestions.filter((s) => dismissed.includes(keyOf(s))),
  );

  function dismiss(s: Suggestion) {
    dismissed = [...dismissed, keyOf(s)];
    saveDismissedSuggestions(page.data.user.id, dismissed);
  }

  function restore(s: Suggestion) {
    dismissed = dismissed.filter((id) => id !== keyOf(s));
    saveDismissedSuggestions(page.data.user.id, dismissed);
  }

  function nameOf(s: Suggestion): string {
    return s.kind === "asset" ? s.title : s.name;
  }

  function done(s: Suggestion) {
    suggestions = suggestions.filter((item) => keyOf(item) !== keyOf(s));
  }

  async function createAsset(s: AssetSuggestion) {
    const asset = await api.call(endpoints.assetsCreate, {
      body: {
        kind: "device",
        name: s.title.trim().slice(0, 120) || m.document_suggestion_untitled(),
        ...(s.createdDate ? { purchaseDate: s.createdDate } : {}),
      },
    });
    try {
      await api.call(endpoints.documentLinksCreate, {
        body: {
          provider: s.provider,
          externalId: s.externalId,
          ownerType: "asset",
          ownerId: asset.id,
          role: "receipt",
        },
      });
    } catch (err) {
      /* Without the link the receipt would be suggested again and again: take the new item back. */
      try {
        await api.call(endpoints.assetsDelete, { params: { id: asset.id } });
      } catch (undoErr) {
        console.warn("suggested asset not removed again", undoErr);
        done(s);
        toast.error(
          m.document_suggestion_link_failed_kept({ name: asset.name }),
        );
        await onadded();
        return;
      }
      throw err;
    }
    done(s);
    toast.success(m.document_suggestion_asset_created({ name: asset.name }), {
      action: {
        label: m.document_suggestion_open(),
        onClick: () => void goto(assetHref(asset.id)),
      },
    });
    await onadded();
  }

  async function createContact(s: ContactSuggestion) {
    const contact = await api.call(endpoints.contactsCreate, {
      body: {
        kind: "other",
        name: s.name.trim().slice(0, 160),
        externalSource: s.externalSource,
        externalRef: s.externalRef,
      },
    });
    done(s);
    toast.success(
      m.document_suggestion_contact_created({ name: contact.name }),
      {
        action: {
          label: m.document_suggestion_open(),
          onClick: () => void goto(contactHref(contact.id)),
        },
      },
    );
    await onadded();
  }

  async function adopt(s: Suggestion) {
    const key = keyOf(s);
    if (busy[key]) return;
    busy[key] = true;
    delete rowError[key];
    try {
      if (s.kind === "asset") await createAsset(s);
      else await createContact(s);
    } catch (err) {
      rowError[key] = apiErrorMessage(err);
    } finally {
      busy[key] = false;
    }
  }

  const title = $derived(
    kind === "asset"
      ? m.document_suggestions_asset_title()
      : m.document_suggestions_contact_title(),
  );
</script>

<Sheet.Root bind:open>
  <Sheet.Content side="right" class="w-full gap-0 p-0 sm:max-w-md">
    <Sheet.Header class="border-b p-4 pe-12">
      <Sheet.Title>{title}</Sheet.Title>
      <Sheet.Description class="text-pretty">
        {kind === "asset"
          ? m.document_suggestions_asset_description()
          : m.document_suggestions_contact_description()}
      </Sheet.Description>
    </Sheet.Header>

    <div class="flex min-h-0 flex-1 flex-col overflow-y-auto">
      {#if loading && suggestions.length === 0}
        <p
          class="text-muted-foreground flex items-center justify-center gap-2 px-4 py-12 text-sm"
          role="status"
        >
          <LoaderCircleIcon class="size-4 animate-spin" aria-hidden="true" />
          {m.document_suggestions_loading()}
        </p>
      {:else if loadError}
        <div
          class="flex flex-col items-center gap-3 px-4 py-12 text-center"
          role="alert"
        >
          <p class="text-destructive text-sm text-pretty">{loadError}</p>
          <Button variant="outline" onclick={load}>{m.common_retry()}</Button>
        </div>
      {:else if suggestions.length === 0}
        <div class="p-4">
          <EmptyState
            icon={kind === "asset" ? FileSearchIcon : ContactIcon}
            title={m.document_suggestions_empty_title()}
            description={kind === "asset"
              ? m.document_suggestions_asset_empty_body()
              : m.document_suggestions_contact_empty_body()}
          />
        </div>
      {:else}
        {#if visible.length === 0}
          <p
            class="text-muted-foreground px-4 py-10 text-center text-sm text-pretty"
          >
            {m.document_suggestions_all_handled()}
          </p>
        {:else}
          <ul class="divide-y" aria-label={title}>
            {#each visible as suggestion (keyOf(suggestion))}
              {@const key = keyOf(suggestion)}
              <li class="flex flex-col gap-3 px-4 py-3">
                <div class="flex min-w-0 flex-col gap-1">
                  {#if suggestion.kind === "asset"}
                    <p class="font-medium break-words">{suggestion.title}</p>
                    <p class="text-muted-foreground text-xs break-words">
                      {[
                        suggestion.correspondentName,
                        suggestion.createdDate
                          ? formatDay(suggestion.createdDate)
                          : null,
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                    </p>
                    {#if suggestion.warrantyUntil}
                      <p class="text-xs tabular-nums">
                        {suggestion.warrantyExtendedUntil
                          ? m.asset_warranty_detail({
                              until: formatDay(suggestion.warrantyUntil),
                              extended: formatDay(
                                suggestion.warrantyExtendedUntil,
                              ),
                            })
                          : m.document_suggestion_warranty({
                              date: formatDay(suggestion.warrantyUntil),
                            })}
                      </p>
                    {/if}
                  {:else}
                    <p class="font-medium break-words">{suggestion.name}</p>
                    <p class="text-muted-foreground text-xs">
                      {m.document_suggestion_documents({
                        count: suggestion.documentCount,
                      })}
                    </p>
                  {/if}
                </div>
                {#if rowError[key]}
                  <p class="text-destructive text-xs text-pretty" role="alert">
                    {rowError[key]}
                  </p>
                {/if}
                <div class="flex gap-2">
                  <Button
                    class="h-10 flex-1"
                    disabled={busy[key]}
                    aria-label={suggestion.kind === "asset"
                      ? m.document_suggestion_asset_aria({
                          name: nameOf(suggestion),
                        })
                      : m.document_suggestion_contact_aria({
                          name: nameOf(suggestion),
                        })}
                    onclick={() => adopt(suggestion)}
                  >
                    {#if busy[key]}
                      <LoaderCircleIcon
                        class="animate-spin"
                      />{m.common_creating()}
                    {:else}
                      <CheckIcon />{suggestion.kind === "asset"
                        ? m.document_suggestion_asset_create()
                        : m.document_suggestion_contact_create()}
                    {/if}
                  </Button>
                  <Button
                    variant="outline"
                    class="h-10"
                    disabled={busy[key]}
                    aria-label={m.device_suggestions_ignore_aria({
                      name: nameOf(suggestion),
                    })}
                    onclick={() => dismiss(suggestion)}
                  >
                    <EyeOffIcon />{m.device_suggestions_ignore()}
                  </Button>
                </div>
              </li>
            {/each}
          </ul>
        {/if}

        {#if ignored.length > 0}
          <div class="border-t p-3">
            <Button
              variant="ghost"
              size="sm"
              class="text-muted-foreground h-9"
              aria-expanded={showDismissed}
              onclick={() => (showDismissed = !showDismissed)}
            >
              {m.document_suggestions_ignored({ count: ignored.length })}
            </Button>
            {#if showDismissed}
              <ul class="mt-2 divide-y rounded-lg border">
                {#each ignored as suggestion (keyOf(suggestion))}
                  <li class="flex items-center justify-between gap-3 px-3 py-2">
                    <span class="min-w-0 text-sm break-words"
                      >{nameOf(suggestion)}</span
                    >
                    <Button
                      variant="ghost"
                      size="sm"
                      class="h-9 shrink-0"
                      aria-label={m.device_suggestions_restore_aria({
                        name: nameOf(suggestion),
                      })}
                      onclick={() => restore(suggestion)}
                    >
                      <RotateCcwIcon />{m.device_suggestions_restore()}
                    </Button>
                  </li>
                {/each}
              </ul>
            {/if}
            <p class="text-muted-foreground mt-2 text-xs text-pretty">
              {m.document_suggestions_local_note()}
            </p>
          </div>
        {/if}
      {/if}
    </div>
  </Sheet.Content>
</Sheet.Root>
