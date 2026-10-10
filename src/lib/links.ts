import { resolve } from "$app/paths";

export function taskHref(id: string) {
  return resolve(`/tasks/${encodeURIComponent(id)}`);
}

export function taskEditHref(id: string) {
  return resolve(`/tasks/${encodeURIComponent(id)}/edit`);
}

/** The asset and room detail pages are built by the inventory pages; the paths are fixed by the app's URL scheme. */
export function assetHref(id: string) {
  return resolve(`/assets/${encodeURIComponent(id)}` as "/");
}

export function roomHref(id: string) {
  return resolve(`/rooms/${encodeURIComponent(id)}` as "/");
}

export function contactHref(id: string) {
  return resolve(`/contacts/${encodeURIComponent(id)}` as "/");
}

export function defectHref(id: string) {
  return resolve(`/defects/${encodeURIComponent(id)}` as "/");
}

export function partHref(id: string) {
  return resolve(`/parts/${encodeURIComponent(id)}` as "/");
}

export function insuranceHref(id: string) {
  return resolve(`/insurance/${encodeURIComponent(id)}` as "/");
}
