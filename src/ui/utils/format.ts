export function formatCount(n: number): string {
  if (!Number.isFinite(n)) return "-";
  const abs = Math.abs(n);
  // thresholds sit where the next unit would otherwise print as "1000k"
  if (abs >= 999_950_000) return `${trimZero((n / 1_000_000_000).toFixed(1))}B`;
  if (abs >= 999_950) return `${trimZero((n / 1_000_000).toFixed(1))}M`;
  if (abs >= 1_000) return `${trimZero((n / 1_000).toFixed(1))}k`;
  return String(Math.round(n));
}

export function formatExact(n: number): string {
  return Number.isFinite(n) ? n.toLocaleString("en-US") : "-";
}

export function exactTitle(n: number): string | undefined {
  const exact = formatExact(n);
  return formatCount(n) === exact ? undefined : exact;
}

function trimZero(value: string): string {
  return value.endsWith(".0") ? value.slice(0, -2) : value;
}
