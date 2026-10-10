<script lang="ts">
  import type { UserLocale } from "$lib/api/enums";
  import { Button } from "$lib/components/ui/button/index.js";
  import * as Card from "$lib/components/ui/card/index.js";
  import { Input } from "$lib/components/ui/input/index.js";
  import { Label } from "$lib/components/ui/label/index.js";
  import { m } from "$lib/paraglide/messages";

  let {
    locale,
    failure,
  }: { locale: UserLocale; failure?: { error: "wrong" | "limited" } | null } =
    $props();
</script>

<Card.Root class="mx-auto mt-16 w-full max-w-sm">
  <Card.Header>
    <Card.Title class="text-xl">{m.guest_pin_title({}, { locale })}</Card.Title>
    <Card.Description>{m.guest_pin_body({}, { locale })}</Card.Description>
  </Card.Header>
  <Card.Content>
    <form method="POST" class="flex flex-col gap-4">
      {#if failure}
        <p role="alert" class="text-destructive text-sm">
          {failure.error === "limited"
            ? m.guest_pin_limited({}, { locale })
            : m.guest_pin_wrong({}, { locale })}
        </p>
      {/if}
      <div class="flex flex-col gap-2">
        <Label for="pin">{m.guest_pin_label({}, { locale })}</Label>
        <Input
          id="pin"
          name="pin"
          type="password"
          inputmode="numeric"
          enterkeyhint="go"
          pattern="[0-9]*"
          minlength={4}
          maxlength={8}
          autocomplete="off"
          required
        />
      </div>
      <Button type="submit" size="lg">
        {m.guest_pin_submit({}, { locale })}
      </Button>
    </form>
  </Card.Content>
</Card.Root>
