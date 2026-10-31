# pi-bansos-router

pi extension for [bansos-router](https://github.com/ihsan-ramadhan/bansos-router), free, keyless coding models via local daemon.

## Installation

```bash
pi install npm:pi-bansos-router
```

Or from local repository path:

```bash
pi install /path/to/bansos-router/extensions/pi
```

OMP (Oh My Pi) loads it too:

```bash
omp plugin install pi-bansos-router
```

## Features

- Registers the `bansosr` provider in pi. The daemon address comes from
  `~/.bansos/state.json`, so an auto-bumped port (17070 -> 17071 when 17070 is
  taken) is picked up instead of assumed.
- Fetches the live free-model list from the daemon (5 s timeout, one retry
  while a fresh daemon seeds its catalog) and caches it in
  `~/.bansos/pi-models.json`. When the daemon cannot be reached it uses that
  cache, and only falls back to the bundled snapshot if no catalog was ever
  cached. Model names carry their upstream (`Big Pickle (Zen)`), and vision
  models are registered with image input.
- Spawns the daemon on demand if it is offline (`bansos start --bg`). The
  daemon runs on Bun (>= 1.3), so Bun must be installed for the auto-spawn to
  succeed; the extension itself runs inside the Node-based pi process.
- On quit, stops only the daemon it started itself: a daemon you were already
  running is left alone.
- `/bansosr` reports router health, the active model count and relay state,
  says so explicitly if the daemon has moved to a different port than this
  session registered, and mentions a newer extension version on npm.
- In strict mode only models from allowlisted upstreams are registered, since
  the daemon's `/v1/models` leaves the others out.

## API key

The daemon requires an API key on every request. The extension finds it the
same way the `bansos` CLI does, after it has made sure the daemon is running:

1. `BANSOS_API_KEY` from the environment (trimmed; empty or blank is ignored)
2. the key file `api-key` in `BANSOS_DIR` (default `~/.bansos/api-key`), which
   the daemon creates on its first start

It registers the provider with that key and sends it as
`Authorization: Bearer <key>` on `/v1/models` and on the `/bansosr` status
check (`/bansos/status`). The extension never generates a key itself; with no
key found it falls back to the old `bansos` placeholder, which the daemon
rejects unless it runs with `BANSOS_AUTH=off`. When the daemon answers 401,
`/bansosr` says so: set `BANSOS_API_KEY` to the daemon's key, or run
`bansos key` to see it. After `bansos key --rotate`, restart pi so the
provider picks up the new key.
