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

- Registers `bansosr` provider in pi pointing to `http://127.0.0.1:17070/v1`.
- Auto-detects and fetches live active free models from bansos daemon.
- Spawns daemon on-demand if offline (`bansos start --bg`).
- Automatically terminates spawned daemon when pi exits.
- Command `/bansosr` to inspect router health and active model count.
