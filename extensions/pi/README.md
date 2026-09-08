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

## Features

- Registers the `bansosr` provider in pi. The daemon address comes from
  `~/.bansos/state.json`, so an auto-bumped port (17070 -> 17071 when 17070 is
  taken) is picked up instead of assumed.
- Fetches the live free-model list from the daemon, falling back to a pinned
  list when the daemon cannot be reached.
- Spawns the daemon on demand if it is offline (`bansos start --bg`).
- On quit, stops only the daemon it started itself: a daemon you were already
  running is left alone.
- `/bansosr` reports router health and the active model count, and says so
  explicitly if the daemon has moved to a different port than this session
  registered.
