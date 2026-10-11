/** A plate for comparing: no case, spaces, dashes or dots, so "ZH 000 000", "zh-000000" and "ZH000000" are one. */
export function plateKey(plate: string): string {
  return plate.toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");
}
