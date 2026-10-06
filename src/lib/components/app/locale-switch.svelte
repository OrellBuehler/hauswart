<script lang="ts">
  import { toast } from "svelte-sonner";
  import { USER_LOCALES, type UserLocale } from "$lib/api/enums";
  import * as DropdownMenu from "$lib/components/ui/dropdown-menu/index.js";
  import { apiErrorMessage } from "$lib/error-message";
  import { saveLocale } from "$lib/locale";
  import { m } from "$lib/paraglide/messages";
  import { getLocale } from "$lib/paraglide/runtime";

  const names: Record<UserLocale, () => string> = {
    de: () => m.locale_name_de(),
    en: () => m.locale_name_en(),
  };

  let pending = $state(false);

  async function change(value: string) {
    const locale = value as UserLocale;
    if (pending || locale === getLocale()) return;
    pending = true;
    try {
      await saveLocale(locale);
    } catch (err) {
      toast.error(apiErrorMessage(err, { internal: m.locale_save_failed() }));
      pending = false;
    }
  }
</script>

<DropdownMenu.Group>
  <DropdownMenu.GroupHeading>{m.user_menu_language()}</DropdownMenu.GroupHeading
  >
  <DropdownMenu.RadioGroup value={getLocale()} onValueChange={change}>
    {#each USER_LOCALES as locale (locale)}
      <DropdownMenu.RadioItem value={locale} disabled={pending}>
        {names[locale]()}
      </DropdownMenu.RadioItem>
    {/each}
  </DropdownMenu.RadioGroup>
</DropdownMenu.Group>
