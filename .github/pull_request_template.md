## What

Short description of the change.

## Why

Why is this needed? Link an issue if one exists.

## How to test

Steps a reviewer (or you) can run to verify:

```bash
bun run typecheck && bun run test && bun run build
cd extensions/pi && npm run typecheck && npm run build
```

## Checklist

- [ ] `bun run typecheck` passes
- [ ] `bun run test` passes
- [ ] `bun run build` passes (root; `npm run build` for `extensions/pi`)
- [ ] No new runtime dependencies added without reason
- [ ] Docs updated if behavior changed (README.md, docs/, CONTRIBUTING.md)
