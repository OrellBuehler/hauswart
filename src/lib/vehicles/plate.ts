/** A plate for comparing: no case, spaces, dashes or dots, so "ZH 123 456", "zh-123456" and "ZH123456" are one. */
export function plateKey(plate: string): string {
  return plate.toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");
}
