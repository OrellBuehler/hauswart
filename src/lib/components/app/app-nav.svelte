<script lang="ts">
  import { resolve } from "$app/paths";
  import * as Sidebar from "$lib/components/ui/sidebar/index.js";
  import { isNavActive, type NavItem } from "./nav";

  let { items, pathname }: { items: NavItem[]; pathname: string } = $props();

  const sidebar = Sidebar.useSidebar();
</script>

<Sidebar.Menu>
  {#each items as item (item.href)}
    {@const active = isNavActive(item, pathname)}
    <Sidebar.MenuItem>
      <Sidebar.MenuButton
        isActive={active}
        tooltipContent={item.label()}
        class="text-sidebar-foreground/80 data-[active=true]:[&>svg]:text-sidebar-primary h-8 transition-colors"
      >
        {#snippet child({ props })}
          <a
            href={resolve(item.href)}
            {...props}
            aria-current={active ? "page" : undefined}
            onclick={() => sidebar.setOpenMobile(false)}
          >
            <item.icon />
            <span>{item.label()}</span>
          </a>
        {/snippet}
      </Sidebar.MenuButton>
    </Sidebar.MenuItem>
  {/each}
</Sidebar.Menu>
