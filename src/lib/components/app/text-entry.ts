/** Input types that open a picker, a keypad of their own or nothing at all instead of the keyboard. */
const NO_KEYBOARD = new Set([
  "button",
  "checkbox",
  "color",
  "date",
  "datetime-local",
  "file",
  "hidden",
  "image",
  "month",
  "radio",
  "range",
  "reset",
  "submit",
  "time",
  "week",
]);

type FocusTarget = {
  tagName?: string;
  type?: string;
  readOnly?: boolean;
  isContentEditable?: boolean;
};

/**
 * Whether focusing the element brings up the on-screen keyboard on a phone: text-like inputs,
 * text areas and editable regions. Checkboxes, buttons and pickers do not.
 */
export function opensKeyboard(target: FocusTarget | null | undefined): boolean {
  if (!target?.tagName || target.readOnly) return false;
  const tag = target.tagName.toLowerCase();
  if (tag === "textarea") return true;
  if (tag === "input")
    return !NO_KEYBOARD.has((target.type ?? "text").toLowerCase());
  return target.isContentEditable === true;
}
