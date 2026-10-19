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
- Spawns the daemon on demand if it is offline (`bansos start --bg`).
- On quit, stops only the daemon it started itself: a daemon you were already
  running is left alone.
- `/bansosr` reports router health, the active model count and relay state,
  says so explicitly if the daemon has moved to a different port than this
  session registered, and mentions a newer extension version on npm.
- In strict mode only models from allowlisted upstreams are registered, since
  the daemon's `/v1/models` leaves the others out.
