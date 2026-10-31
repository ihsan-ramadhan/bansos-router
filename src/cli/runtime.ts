// no imports: the guard entry must load under any runtime to explain why bansos will not start
export const MIN_BUN_VERSION = "1.3.0";

type BunLike = { version: string; semver: { satisfies(version: string, range: string): boolean } };

export function runtimeError(
  g: { Bun?: BunLike } = globalThis,
  versions: { node?: string } = process.versions,
): string | null {
  const bun = g.Bun;
  if (bun && bun.semver.satisfies(bun.version, `>=${MIN_BUN_VERSION}`)) return null;
  const found = bun ? `Bun ${bun.version}` : `Node ${versions.node ?? "unknown"}`;
  return (
    `bansos requires Bun >= ${MIN_BUN_VERSION} (found ${found}). Install Bun from https://bun.sh and run bansos again. ` +
    `If an autostart entry from an older bansos started this, run "bansos autostart on" again.`
  );
}
