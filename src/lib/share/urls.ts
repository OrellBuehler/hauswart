/** The address as the browser sees it: a bare path from the API gets the page's origin. */
export function absoluteUrl(url: string, origin: string): string {
  return new URL(url, origin).href;
}

/** `webcal://` variant of a subscription address: calendar apps open it as a subscription. */
export function webcalUrl(url: string): string {
  return url.replace(/^https?:/i, "webcal:");
}
