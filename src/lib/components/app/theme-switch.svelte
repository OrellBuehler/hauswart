<script lang="ts">
  import MonitorIcon from "@lucide/svelte/icons/monitor";
  import MoonIcon from "@lucide/svelte/icons/moon";
  import SunIcon from "@lucide/svelte/icons/sun";
  import { setMode, userPrefersMode } from "mode-watcher";
  import * as DropdownMenu from "$lib/components/ui/dropdown-menu/index.js";
  import { m } from "$lib/paraglide/messages";

  const modes = [
    { value: "light", label: () => m.theme_light(), icon: SunIcon },
    { value: "dark", label: () => m.theme_dark(), icon: MoonIcon },
    { value: "system", label: () => m.theme_system(), icon: MonitorIcon },
  ] as const;
</script>

<DropdownMenu.Group>
  <DropdownMenu.GroupHeading>{m.user_menu_theme()}</DropdownMenu.GroupHeading>
  <DropdownMenu.RadioGroup
    value={userPrefersMode.current}
    onValueChange={(value) => setMode(value as (typeof modes)[number]["value"])}
  >
    {#each modes as mode (mode.value)}
      <DropdownMenu.RadioItem value={mode.value}>
        <mode.icon />
        {mode.label()}
      </DropdownMenu.RadioItem>
    {/each}
  </DropdownMenu.RadioGroup>
</DropdownMenu.Group>
