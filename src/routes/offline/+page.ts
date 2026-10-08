// The service worker shows this page, once cached, in place of an app page it could not load.
// Without JavaScript nothing hydrates: SvelteKit would otherwise route on the address of the page
// that failed, not on this one.
export const csr = false;
