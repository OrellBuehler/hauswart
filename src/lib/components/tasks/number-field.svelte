<script lang="ts">
  import { Input } from "$lib/components/ui/input/index.js";
  import { cn } from "$lib/utils";

  let {
    id,
    value = $bindable(),
    decimal = false,
    placeholder,
    invalid = false,
    describedby,
    disabled = false,
    class: className,
    onchange,
  }: {
    id?: string;
    value?: number | undefined;
    decimal?: boolean;
    placeholder?: string;
    invalid?: boolean;
    describedby?: string | undefined;
    disabled?: boolean;
    class?: string;
    onchange?: () => void;
  } = $props();

  function parse(text: string): number | undefined {
    const trimmed = text.trim().replace(",", ".");
    if (trimmed === "") return undefined;
    const parsed = Number(trimmed);
    return Number.isFinite(parsed) ? parsed : Number.NaN;
  }

  let text = $state(value === undefined ? "" : String(value));

  $effect(() => {
    const current = parse(text);
    if (current !== value && !(Number.isNaN(current) && value === undefined)) {
      text = value === undefined ? "" : String(value);
    }
  });

  function oninput(event: Event & { currentTarget: HTMLInputElement }) {
    text = event.currentTarget.value;
    const parsed = parse(text);
    value = parsed === undefined || Number.isNaN(parsed) ? undefined : parsed;
    onchange?.();
  }
</script>

<Input
  {id}
  type="text"
  inputmode={decimal ? "decimal" : "numeric"}
  autocomplete="off"
  {placeholder}
  {disabled}
  aria-invalid={invalid || undefined}
  aria-describedby={describedby}
  class={cn("h-10 tabular-nums", className)}
  value={text}
  {oninput}
/>
