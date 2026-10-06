export type StockLevel = "empty" | "low" | "ok";

/** Empty at zero, low once the stock is at or below a set minimum, otherwise fine. */
export function stockLevel(part: {
  stockCount: number;
  minStock: number;
}): StockLevel {
  if (part.stockCount <= 0) return "empty";
  if (part.minStock > 0 && part.stockCount <= part.minStock) return "low";
  return "ok";
}
