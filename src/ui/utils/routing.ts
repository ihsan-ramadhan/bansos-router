import type { ActivityEvent } from "../types";

export const MAX_TRIPS_PER_POLL = 3;
export const MAX_FRESH_BEFORE_SEED = 4;

export interface FreshEvents {
  fresh: ActivityEvent[];
  seed: boolean;
}

export function diffEvents(
  events: ActivityEvent[],
  seen: Set<number>,
  lastMaxTimestamp: number,
): FreshEvents {
  const unseen = events
    .filter((e) => !seen.has(e.id) && e.timestamp >= lastMaxTimestamp)
    .sort((a, b) => a.timestamp - b.timestamp);
  if (unseen.length > MAX_FRESH_BEFORE_SEED) return { fresh: [], seed: true };
  return { fresh: unseen.slice(-MAX_TRIPS_PER_POLL), seed: false };
}

export interface Point {
  x: number;
  y: number;
}

function unit(from: Point, to: Point): Point {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const len = Math.hypot(dx, dy) || 1;
  return { x: dx / len, y: dy / len };
}

export function routePath(points: Point[], radius = 14): string {
  const first = points[0];
  if (!first) return "";
  let d = `M ${round(first.x)} ${round(first.y)}`;
  for (let i = 1; i < points.length - 1; i++) {
    const prev = points[i - 1];
    const cur = points[i];
    const next = points[i + 1];
    if (!prev || !cur || !next) continue;
    const back = unit(cur, prev);
    const fwd = unit(cur, next);
    const turn = back.x * fwd.x + back.y * fwd.y;
    if (turn < -0.99 || turn > 0.99) {
      d += ` L ${round(cur.x)} ${round(cur.y)}`;
      continue;
    }
    const r = Math.min(
      radius,
      Math.hypot(prev.x - cur.x, prev.y - cur.y) / 2,
      Math.hypot(next.x - cur.x, next.y - cur.y) / 2,
    );
    const enter = { x: cur.x + back.x * r, y: cur.y + back.y * r };
    const exit = { x: cur.x + fwd.x * r, y: cur.y + fwd.y * r };
    d += ` L ${round(enter.x)} ${round(enter.y)} Q ${round(cur.x)} ${round(cur.y)} ${round(exit.x)} ${round(exit.y)}`;
  }
  const last = points[points.length - 1];
  if (!last) return d;
  return `${d} L ${round(last.x)} ${round(last.y)}`;
}

function round(n: number): number {
  return Math.round(n * 10) / 10;
}

export function sCurvePath(from: Point, to: Point): string {
  const dx = to.x - from.x;
  const c1x = from.x + dx * 0.5;
  const c1y = from.y;
  const c2x = from.x + dx * 0.5;
  const c2y = to.y;
  return `M ${round(from.x)} ${round(from.y)} C ${round(c1x)} ${round(c1y)}, ${round(c2x)} ${round(c2y)}, ${round(to.x)} ${round(to.y)}`;
}

export function buildTripRoute(hCenter: Point, rCenter: Point, rExit: Point, arrival: Point): string {
  const dx = arrival.x - rExit.x;
  const c1x = rExit.x + dx * 0.5;
  const c1y = rExit.y;
  const c2x = rExit.x + dx * 0.5;
  const c2y = arrival.y;

  return `M ${round(hCenter.x)} ${round(hCenter.y)} ` +
    `L ${round(rCenter.x)} ${round(rCenter.y)} ` +
    `L ${round(rExit.x)} ${round(rExit.y)} ` +
    `C ${round(c1x)} ${round(c1y)}, ${round(c2x)} ${round(c2y)}, ${round(arrival.x)} ${round(arrival.y)} ` +
    `C ${round(c2x)} ${round(c2y)}, ${round(c1x)} ${round(c1y)}, ${round(rExit.x)} ${round(rExit.y)} ` +
    `L ${round(rCenter.x)} ${round(rCenter.y)} ` +
    `L ${round(hCenter.x)} ${round(hCenter.y)}`;
}

export function verticalBusPath(routerBottom: Point, busX: number, targetLeft: Point): string {
  const startY = routerBottom.y;
  const curveEndY = Math.min(startY + 24, targetLeft.y);
  const c1x = routerBottom.x;
  const c1y = startY + 14;
  const c2x = busX;
  const c2y = startY + 10;
  return `M ${round(routerBottom.x)} ${round(startY)} ` +
    `C ${round(c1x)} ${round(c1y)}, ${round(c2x)} ${round(c2y)}, ${round(busX)} ${round(curveEndY)} ` +
    `L ${round(busX)} ${round(targetLeft.y)} ` +
    `L ${round(targetLeft.x)} ${round(targetLeft.y)}`;
}

export function buildVerticalTripRoute(
  hCenter: Point,
  hBottom: Point,
  rTop: Point,
  rCenter: Point,
  rBottom: Point,
  busX: number,
  targetLeft: Point,
): string {
  const startY = rBottom.y;
  const curveEndY = Math.min(startY + 24, targetLeft.y);
  const c1x = rBottom.x;
  const c1y = startY + 14;
  const c2x = busX;
  const c2y = startY + 10;

  return `M ${round(hCenter.x)} ${round(hCenter.y)} ` +
    `L ${round(hBottom.x)} ${round(hBottom.y)} ` +
    `L ${round(rTop.x)} ${round(rTop.y)} ` +
    `L ${round(rCenter.x)} ${round(rCenter.y)} ` +
    `L ${round(rBottom.x)} ${round(rBottom.y)} ` +
    `C ${round(c1x)} ${round(c1y)}, ${round(c2x)} ${round(c2y)}, ${round(busX)} ${round(curveEndY)} ` +
    `L ${round(busX)} ${round(targetLeft.y)} ` +
    `L ${round(targetLeft.x)} ${round(targetLeft.y)} ` +
    `L ${round(busX)} ${round(targetLeft.y)} ` +
    `L ${round(busX)} ${round(curveEndY)} ` +
    `C ${round(c2x)} ${round(c2y)}, ${round(c1x)} ${round(c1y)}, ${round(rBottom.x)} ${round(rBottom.y)} ` +
    `L ${round(rCenter.x)} ${round(rCenter.y)} ` +
    `L ${round(rTop.x)} ${round(rTop.y)} ` +
    `L ${round(hBottom.x)} ${round(hBottom.y)} ` +
    `L ${round(hCenter.x)} ${round(hCenter.y)}`;
}
