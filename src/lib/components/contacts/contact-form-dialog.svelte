<script lang="ts">
  import { toast } from "svelte-sonner";
  import { api } from "$lib/api/browser";
  import { CONTACT_KINDS, type ContactKind } from "$lib/api/enums";
  import { endpoints } from "$lib/api/registry";
  import type { Contact } from "$lib/api/schemas/contacts";
  import FormDialog from "$lib/components/app/form-dialog.svelte";
  import SwitchField from "$lib/components/app/switch-field.svelte";
  import Field from "$lib/components/tasks/field.svelte";
  import OptionSelect from "$lib/components/tasks/option-select.svelte";
  import { Input } from "$lib/components/ui/input/index.js";
  import { Textarea } from "$lib/components/ui/textarea/index.js";
  import { contactKindLabels } from "$lib/contacts/labels";
  import { apiErrorMessage } from "$lib/error-message";
  import { m } from "$lib/paraglide/messages";
  import { apiFieldErrors } from "$lib/tasks/field-errors";

  let {
    open = $bindable(false),
    contact,
    initialName = "",
    initialKind = "other",
    onsaved,
  }: {
    open?: boolean;
    /** The contact to edit; undefined creates a new one. */
    contact?: Contact | undefined;
    initialName?: string;
    initialKind?: ContactKind;
    onsaved: (contact: Contact) => void | Promise<void>;
  } = $props();

  let kind = $state<string>("other");
  let name = $state("");
  let company = $state("");
  let phone = $state("");
  let email = $state("");
  let url = $state("");
  let address = $state("");
  let notes = $state("");
  let emergency = $state(false);
  let guestVisible = $state(false);
  let fieldErrors = $state<Record<string, string>>({});

  const editing = $derived(contact !== undefined);
  const kindOptions = CONTACT_KINDS.map((value) => ({
    value,
    label: contactKindLabels[value](),
  }));

  $effect(() => {
    if (!open) return;
    kind = contact?.kind ?? initialKind;
    name = contact?.name ?? initialName;
    company = contact?.company ?? "";
    phone = contact?.phone ?? "";
    email = contact?.email ?? "";
    url = contact?.url ?? "";
    address = contact?.address ?? "";
    notes = contact?.notes ?? "";
    emergency = contact?.emergency ?? initialKind === "emergency";
    guestVisible = contact?.guestVisible ?? false;
    fieldErrors = {};
  });

  async function submit(): Promise<string | void> {
    fieldErrors = {};
    if (!name.trim()) {
      fieldErrors = { name: m.field_required() };
      return m.form_check_fields();
    }
    const fields = {
      kind: kind as ContactKind,
      name,
      company,
      phone,
      email,
      url,
      address,
      notes,
      emergency,
      guestVisible,
    };
    try {
      const saved = contact
        ? await api.call(endpoints.contactsUpdate, {
            params: { id: contact.id },
            body: fields,
          })
        : await api.call(endpoints.contactsCreate, { body: fields });
      toast.success(
        editing
          ? m.contact_saved_toast({ name: saved.name })
          : m.contact_created_toast({ name: saved.name }),
      );
      await onsaved(saved);
    } catch (err) {
      fieldErrors = apiFieldErrors(err);
      if (Object.keys(fieldErrors).length > 0) return m.form_check_fields();
      return apiErrorMessage(err);
    }
  }
</script>

<FormDialog
  bind:open
  title={editing ? m.contact_edit_title() : m.contact_create_title()}
  description={editing
    ? m.contact_edit_description()
    : m.contact_create_description()}
  submitLabel={editing ? m.common_save() : m.common_create()}
  pendingLabel={editing ? m.common_saving() : m.common_creating()}
  onsubmit={submit}
>
  <Field id="contact-kind" label={m.contact_kind()}>
    {#snippet children({ describedby })}
      <OptionSelect
        id="contact-kind"
        options={kindOptions}
        bind:value={kind}
        {describedby}
      />
    {/snippet}
  </Field>
  <Field id="contact-name" label={m.contact_name()} error={fieldErrors.name}>
    {#snippet children({ describedby, invalid })}
      <Input
        id="contact-name"
        autocomplete="off"
        maxlength={160}
        aria-invalid={invalid || undefined}
        aria-describedby={describedby}
        class="h-10"
        bind:value={name}
      />
    {/snippet}
  </Field>
  <Field
    id="contact-company"
    label={m.contact_company()}
    optional
    error={fieldErrors.company}
  >
    {#snippet children({ describedby, invalid })}
      <Input
        id="contact-company"
        autocomplete="off"
        maxlength={160}
        aria-invalid={invalid || undefined}
        aria-describedby={describedby}
        class="h-10"
        bind:value={company}
      />
    {/snippet}
  </Field>
  <div class="grid gap-5 sm:grid-cols-2">
    <Field
      id="contact-phone"
      label={m.contact_phone()}
      optional
      error={fieldErrors.phone}
    >
      {#snippet children({ describedby, invalid })}
        <Input
          id="contact-phone"
          type="tel"
          autocomplete="off"
          maxlength={60}
          aria-invalid={invalid || undefined}
          aria-describedby={describedby}
          class="h-10"
          bind:value={phone}
        />
      {/snippet}
    </Field>
    <Field
      id="contact-email"
      label={m.contact_email()}
      optional
      error={fieldErrors.email}
    >
      {#snippet children({ describedby, invalid })}
        <Input
          id="contact-email"
          type="email"
          autocomplete="off"
          autocapitalize="none"
          spellcheck={false}
          maxlength={254}
          aria-invalid={invalid || undefined}
          aria-describedby={describedby}
          class="h-10"
          bind:value={email}
        />
      {/snippet}
    </Field>
  </div>
  <Field
    id="contact-url"
    label={m.contact_url()}
    optional
    hint={m.contact_url_hint()}
    error={fieldErrors.url}
  >
    {#snippet children({ describedby, invalid })}
      <Input
        id="contact-url"
        type="url"
        autocomplete="off"
        autocapitalize="none"
        spellcheck={false}
        maxlength={2048}
        placeholder="https://"
        aria-invalid={invalid || undefined}
        aria-describedby={describedby}
        class="h-10"
        bind:value={url}
      />
    {/snippet}
  </Field>
  <Field
    id="contact-address"
    label={m.contact_address()}
    optional
    error={fieldErrors.address}
  >
    {#snippet children({ describedby, invalid })}
      <Textarea
        id="contact-address"
        rows={2}
        maxlength={500}
        aria-invalid={invalid || undefined}
        aria-describedby={describedby}
        bind:value={address}
      />
    {/snippet}
  </Field>
  <Field
    id="contact-notes"
    label={m.contact_notes()}
    optional
    error={fieldErrors.notes}
  >
    {#snippet children({ describedby, invalid })}
      <Textarea
        id="contact-notes"
        rows={3}
        maxlength={10000}
        aria-invalid={invalid || undefined}
        aria-describedby={describedby}
        bind:value={notes}
      />
    {/snippet}
  </Field>
  <div class="flex flex-col gap-4">
    <SwitchField
      id="contact-emergency"
      bind:checked={emergency}
      label={m.contact_emergency()}
      hint={m.contact_emergency_hint()}
    />
    <SwitchField
      id="contact-guest"
      bind:checked={guestVisible}
      label={m.contact_guest_visible()}
      hint={m.contact_guest_visible_hint()}
    />
  </div>
</FormDialog>
