/** The parts of an element that `routerOptions` reads. */
export type OptionsNode = {
  getAttribute(name: string): string | null;
  parentElement: OptionsNode | null;
};

export type RouterOptions = {
  replaceState?: boolean;
  noScroll?: boolean;
  keepFocus?: boolean;
};

function flag(value: string | null): boolean | undefined {
  if (value === "" || value === "true") return true;
  if (value === "off" || value === "false") return false;
  return undefined;
}

/**
 * What the `data-sveltekit-replacestate`, `-noscroll` and `-keepfocus` attributes on a link or on any
 * element around it ask for, read the way the router reads them: the nearest element that has the
 * attribute decides, and a value it does not know means "not set".
 */
export function routerOptions(link: OptionsNode): RouterOptions {
  const raw: Record<"replacestate" | "noscroll" | "keepfocus", string | null> =
    { replacestate: null, noscroll: null, keepfocus: null };
  for (let el: OptionsNode | null = link; el; el = el.parentElement) {
    for (const name of Object.keys(raw) as Array<keyof typeof raw>) {
      raw[name] ??= el.getAttribute(`data-sveltekit-${name}`);
    }
  }
  const options: RouterOptions = {};
  const replaceState = flag(raw.replacestate);
  const noScroll = flag(raw.noscroll);
  const keepFocus = flag(raw.keepfocus);
  if (replaceState !== undefined) options.replaceState = replaceState;
  if (noScroll !== undefined) options.noScroll = noScroll;
  if (keepFocus !== undefined) options.keepFocus = keepFocus;
  return options;
}
