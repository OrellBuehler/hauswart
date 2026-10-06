<script lang="ts">
  import { Badge } from "$lib/components/ui/badge/index.js";
  import { Button } from "$lib/components/ui/button/index.js";
  import type { ApiToken } from "$lib/api/schemas/tokens";
  import { formatDate } from "$lib/format";
  import { m } from "$lib/paraglide/messages";
  import { kindLabel, scopeLabel } from "./token-labels";

  let {
    token,
    revokeLabel,
    revokeAriaLabel,
    onrevoke,
  }: {
    token: ApiToken;
    revokeLabel: string;
    revokeAriaLabel: string;
    onrevoke: () => void;
  } = $props();

  const expired = $derived(
    token.expiresAt !== null &&
      new Date(token.expiresAt).getTime() <= Date.now(),
  );
</script>

<li
  class="flex flex-col gap-3 p-4 sm:flex-row sm:items-start sm:justify-between"
>
  <div class="flex min-w-0 flex-col gap-2">
    <div class="flex flex-wrap items-center gap-x-2 gap-y-1">
      <span class="min-w-0 font-medium break-words">{token.name}</span>
      <Badge variant="secondary">{kindLabel(token.kind)}</Badge>
      {#if expired}
        <Badge variant="destructive">{m.token_expired()}</Badge>
      {/if}
    </div>
    <p
      class="text-muted-foreground font-mono text-xs"
      title={m.token_prefix_label()}
    >
      {token.prefix}…
    </p>
    <ul class="flex flex-wrap gap-1" aria-label={m.tokens_scopes()}>
      {#each token.scopes as scope (scope)}
        <li><Badge variant="outline">{scopeLabel(scope)}</Badge></li>
      {/each}
    </ul>
    <p class="text-muted-foreground text-xs text-pretty">
      {token.lastUsedAt
        ? m.token_last_used({ date: formatDate(token.lastUsedAt) })
        : m.token_never_used()}
      ·
      {token.expiresAt
        ? m.token_expires({ date: formatDate(token.expiresAt) })
        : m.token_no_expiry()}
      · {m.token_created_at({ date: formatDate(token.createdAt) })}
    </p>
  </div>
  <Button
    type="button"
    variant="outline"
    size="sm"
    class="text-destructive hover:text-destructive shrink-0 self-start"
    aria-label={revokeAriaLabel}
    onclick={onrevoke}
  >
    {revokeLabel}
  </Button>
</li>
