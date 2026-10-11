/** What `shareOrCopy` needs of the browser; the real `navigator` has all of it, and a test can bring a fake. */
export type ShareEnv = {
  share?:
    ((data: { title?: string; text?: string }) => Promise<void>) | undefined;
  canShare?: ((data: { title?: string; text?: string }) => boolean) | undefined;
  clipboard?: { writeText: (text: string) => Promise<void> } | undefined;
  /** Whether sharing is the natural thing here: a phone has a share sheet worth opening, a desktop browser's is not what "copy" means. */
  preferShare: boolean;
};

export type ShareOutcome = "shared" | "copied" | "cancelled";

/** The environment of the running browser: a touch screen shares, everything else copies. */
export function browserShareEnv(): ShareEnv {
  const nav = navigator;
  return {
    share: typeof nav.share === "function" ? nav.share.bind(nav) : undefined,
    canShare:
      typeof nav.canShare === "function" ? nav.canShare.bind(nav) : undefined,
    clipboard: nav.clipboard,
    preferShare: window.matchMedia("(pointer: coarse)").matches,
  };
}

function isAbort(err: unknown): boolean {
  return err instanceof DOMException
    ? err.name === "AbortError"
    : typeof err === "object" &&
        err !== null &&
        (err as { name?: unknown }).name === "AbortError";
}

/**
 * Hands the text to the share sheet where there is one worth using, else puts it on the clipboard.
 * A person who closes the share sheet is not an error (`cancelled`); a share that fails for another
 * reason falls back to the clipboard, and only when that is missing or refused too does it throw.
 */
export async function shareOrCopy(
  payload: { title: string; text: string },
  env: ShareEnv,
): Promise<ShareOutcome> {
  if (env.preferShare && env.share && (env.canShare?.(payload) ?? true)) {
    try {
      await env.share(payload);
      return "shared";
    } catch (err) {
      if (isAbort(err)) return "cancelled";
      console.warn("share failed, copying instead", err);
    }
  }
  if (!env.clipboard)
    throw new Error("Neither sharing nor the clipboard is available");
  await env.clipboard.writeText(payload.text);
  return "copied";
}
