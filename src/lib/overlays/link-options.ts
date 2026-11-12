/** The parts of an element that `routerOptions` reads. */
export type OptionsNode = {
  getAttribute(name: string): string | null;
  parentElement: OptionsNode | null;
};

export type RouterOptions = {
  replace?: boolean;
  reset?: boolean;
};

function flag(value: string | null): boolean | undefined {
  if (value === "" || value === "true") return true;
  if (value === "false") return false;
  return undefined;
}

/**
 * What the `data-sveltekit-replacestate` and `-reset` attributes on a link or on any element around
 * it ask for, read the way the router reads them: the nearest element that has the attribute decides,
 * and a value it does not know means "not set".
 */
export function routerOptions(link: OptionsNode): RouterOptions {
  const raw: Record<"replacestate" | "reset", string | null> = {
    replacestate: null,
    reset: null,
  };
  for (let el: OptionsNode | null = link; el; el = el.parentElement) {
    for (const name of Object.keys(raw) as Array<keyof typeof raw>) {
      raw[name] ??= el.getAttribute(`data-sveltekit-${name}`);
    }
  }
  const options: RouterOptions = {};
  const replace = flag(raw.replacestate);
  const reset = flag(raw.reset);
  if (replace !== undefined) options.replace = replace;
  if (reset !== undefined) options.reset = reset;
  return options;
}
