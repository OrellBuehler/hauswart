<script lang="ts">
  import * as Dialog from "$lib/components/ui/dialog/index.js";
  import { cn, type WithoutChildrenOrChild } from "$lib/utils.js";
  import Command from "./command.svelte";
  import type {
    Command as CommandPrimitive,
    Dialog as DialogPrimitive,
  } from "bits-ui";
  import type { Snippet } from "svelte";

  let {
    open = $bindable(false),
    ref = $bindable(null),
    value = $bindable(""),
    title,
    description,
    portalProps,
    children,
    class: className,
    ...restProps
  }: WithoutChildrenOrChild<DialogPrimitive.RootProps> &
    WithoutChildrenOrChild<CommandPrimitive.RootProps> & {
      portalProps?: DialogPrimitive.PortalProps;
      children: Snippet;
      title: string;
      description: string;
      class?: string;
    } = $props();
</script>

<Dialog.Root bind:open>
  <Dialog.Content
    class={cn(
      "top-[max(1rem,10svh)] translate-y-0 gap-0 overflow-hidden p-0 sm:top-[15svh]",
      className,
    )}
    showCloseButton={false}
    {portalProps}
  >
    <Dialog.Header class="sr-only">
      <Dialog.Title>{title}</Dialog.Title>
      <Dialog.Description>{description}</Dialog.Description>
    </Dialog.Header>
    <Command {...restProps} bind:value bind:ref {children} />
  </Dialog.Content>
</Dialog.Root>
