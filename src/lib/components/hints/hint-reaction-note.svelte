<script lang="ts">
  import BellRingIcon from "@lucide/svelte/icons/bell-ring";
  import type { SignalReaction } from "#lib/api/schemas/hints.ts";
  import { m } from "#lib/paraglide/messages.js";

  let { reaction }: { reaction: SignalReaction } = $props();

  const who = $derived(
    Array.isArray(reaction.notify)
      ? m.hint_reaction_notify_custom()
      : reaction.notify === "assignee"
        ? m.hint_reaction_notify_assignee()
        : m.hint_reaction_notify_all(),
  );
</script>

<p
  class="text-muted-foreground flex items-start gap-1.5 text-xs text-pretty"
  title={m.hint_reaction_note()}
>
  <BellRingIcon class="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
  <span class="min-w-0 break-words">
    {m.hint_reaction_summary({
      entity: reaction.entityId,
      to: reaction.toState,
      who,
    })}
  </span>
</p>
