<script lang="ts">
  import { untrack } from "svelte";
  import { toast } from "svelte-sonner";
  import { api } from "$lib/api/browser";
  import {
    DOCUMENT_LINK_ROLES,
    type DocumentLinkOwnerType,
    type DocumentLinkRole,
    type DocumentProviderKind,
  } from "$lib/api/enums";
  import { endpoints } from "$lib/api/registry";
  import type { Attachment } from "$lib/api/schemas/attachments";
  import FormDialog from "$lib/components/app/form-dialog.svelte";
  import Field from "$lib/components/tasks/field.svelte";
  import OptionSelect from "$lib/components/tasks/option-select.svelte";
  import { Input } from "$lib/components/ui/input/index.js";
  import { baseName } from "$lib/attachments/files";
  import { defaultRoleFor, documentRoleLabels } from "$lib/documents/labels";
  import { trackPush } from "$lib/documents/pushes.svelte";
  import { apiErrorMessage } from "$lib/error-message";
  import { m } from "$lib/paraglide/messages";

  const TITLE_MAX = 128;

  let {
    open = $bindable(false),
    attachment,
    ownerType,
    provider,
  }: {
    open?: boolean;
    attachment: Attachment | undefined;
    ownerType: DocumentLinkOwnerType;
    provider: DocumentProviderKind;
  } = $props();

  let title = $state("");
  let role = $state<string>("other");
  let label = $state("");
  let titleError = $state<string | undefined>();

  const roleOptions = DOCUMENT_LINK_ROLES.map((value) => ({
    value,
    label: documentRoleLabels[value](),
  }));

  $effect(() => {
    if (!open || !attachment) return;
    const current = attachment;
    untrack(() => {
      title = (current.caption?.trim() || baseName(current.filename)).slice(
        0,
        TITLE_MAX,
      );
      role = defaultRoleFor(ownerType);
      label = "";
      titleError = undefined;
    });
  });

  async function submit(): Promise<string | void> {
    if (!attachment) return;
    titleError = undefined;
    const name = title.trim();
    if (name === "") {
      titleError = m.field_required();
      return titleError;
    }
    let upload;
    try {
      upload = await api.call(endpoints.attachmentsPushToDocuments, {
        params: { id: attachment.id },
        body: {
          provider,
          title: name,
          role: role as DocumentLinkRole,
          ...(label.trim() ? { label: label.trim() } : {}),
        },
      });
    } catch (err) {
      return apiErrorMessage(err, {
        not_found: m.document_push_not_connected(),
      });
    }
    trackPush(upload, name);
    toast.info(m.document_push_started({ name }));
  }
</script>

<FormDialog
  bind:open
  title={m.document_push_title()}
  description={attachment
    ? m.document_push_description({ name: attachment.filename })
    : undefined}
  submitLabel={m.document_push_submit()}
  pendingLabel={m.document_push_submitting()}
  onsubmit={submit}
>
  <Field
    id="doc-push-title"
    label={m.document_push_name()}
    hint={m.document_push_name_hint()}
    error={titleError}
  >
    {#snippet children({ describedby, invalid })}
      <Input
        id="doc-push-title"
        class="h-10"
        maxlength={TITLE_MAX}
        autocomplete="off"
        bind:value={title}
        aria-invalid={invalid || undefined}
        aria-describedby={describedby}
      />
    {/snippet}
  </Field>
  <Field
    id="doc-push-role"
    label={m.document_push_role()}
    hint={m.document_push_role_hint()}
  >
    {#snippet children({ describedby })}
      <OptionSelect
        id="doc-push-role"
        options={roleOptions}
        bind:value={role}
        {describedby}
      />
    {/snippet}
  </Field>
  <Field
    id="doc-push-label"
    label={m.document_link_label()}
    hint={m.document_link_label_hint()}
    optional
  >
    {#snippet children({ describedby })}
      <Input
        id="doc-push-label"
        class="h-10"
        maxlength={200}
        autocomplete="off"
        bind:value={label}
        aria-describedby={describedby}
      />
    {/snippet}
  </Field>
</FormDialog>
