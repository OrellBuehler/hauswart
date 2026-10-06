<script lang="ts">
  import PlugZapIcon from "@lucide/svelte/icons/plug-zap";
  import * as Alert from "$lib/components/ui/alert/index.js";
  import { m } from "$lib/paraglide/messages";
</script>

<Alert.Root>
  <PlugZapIcon />
  <Alert.Title>{m.trigger_advanced_title()}</Alert.Title>
  <Alert.Description>{m.trigger_advanced_body()}</Alert.Description>
</Alert.Root>
