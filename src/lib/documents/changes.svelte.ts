/**
 * Counts the changes made to document links in this browser tab, so every list of linked documents
 * on the page reloads when one of them (or a finished push) adds or removes a link.
 */
export const documentLinkChanges = $state({ version: 0 });

export function documentLinksChanged(): void {
  documentLinkChanges.version += 1;
}
