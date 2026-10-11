export type TrendPoint = { date: string; value: number };

export type Sparkline = {
  line: string;
  area: string;
  dots: { x: number; y: number; point: TrendPoint }[];
  min: TrendPoint;
  max: TrendPoint;
  first: TrendPoint;
  last: TrendPoint;
};

const round = (value: number): number => Math.round(value * 100) / 100;

export function sparkline(
  points: readonly TrendPoint[],
  width: number,
  height: number,
  padding = 4,
): Sparkline | null {
  if (points.length < 2) return null;
  const values = points.map((p) => p.value);
  const lowest = Math.min(...values);
  const highest = Math.max(...values);
  const span = highest - lowest;
  const innerWidth = width - 2 * padding;
  const innerHeight = height - 2 * padding;
  const dots = points.map((point, index) => ({
    x: round(padding + (innerWidth * index) / (points.length - 1)),
    y: round(
      span === 0
        ? height / 2
        : padding + innerHeight * (1 - (point.value - lowest) / span),
    ),
    point,
  }));
  const line = dots
    .map((dot, index) => `${index === 0 ? "M" : "L"}${dot.x} ${dot.y}`)
    .join(" ");
  const bottom = height - padding;
  const firstDot = dots[0];
  const lastDot = dots[dots.length - 1];
  return {
    line,
    area: `${line} L${lastDot.x} ${bottom} L${firstDot.x} ${bottom} Z`,
    dots,
    min: points.find((p) => p.value === lowest) as TrendPoint,
    max: points.find((p) => p.value === highest) as TrendPoint,
    first: points[0],
    last: points[points.length - 1],
  };
}

export function priceSeries<
  T extends { date: string; unit: string; pricePerUnitMinor: number },
>(trend: readonly T[], unit: T["unit"]): TrendPoint[] {
  return trend
    .filter((entry) => entry.unit === unit && entry.pricePerUnitMinor > 0)
    .map((entry) => ({ date: entry.date, value: entry.pricePerUnitMinor }));
}
