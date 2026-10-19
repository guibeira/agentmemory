# Docker deployments

agentmemory 0.9.30 runs on iii 0.24.6 with the `state` 0.22.20 and `http` 0.22.7 registry workers. All image builds use one [`Dockerfile`](Dockerfile), with engine and registry worker pins declared once. Update those build arguments together when promoting a release. Workers are fetched from the iii registry at startup; the `worker-compose.yaml` uses the same Worker Compose format as the CLI.

The container runs `iii compose --up`: Compose owns the engine and supervises `state`, `http`, and the local `agentmemory` worker. There is no legacy embedded engine config, standalone stream, pubsub, or queue worker. The registry worker artifacts are pinned in the compose manifest. Engine and worker state, agentmemory state, generated secret, Compose cache, and logs live on the persistent `/data` volume.

## Ports

| Container port | Service | Use |
|---|---|---|
| `3111` | HTTP worker | REST API and authenticated SSE at `/agentmemory/viewer/events` |
| `3113` | agentmemory viewer | Browser UI and its authenticated REST proxy |
| `49134` | iii engine | Internal worker WebSocket; never publish it |

There is no stream/WebSocket viewer port. Keep the viewer behind TLS and set `VIEWER_ALLOWED_HOSTS` to the exact inbound `Host` values (with port where present) and `VIEWER_ALLOWED_ORIGINS` to its browser origins. It requires `AGENTMEMORY_SECRET` for API proxy calls; the viewer prompts for the bearer and keeps it in session storage. Do not expose the engine port.

Local Compose binds REST and viewer to loopback. Example with test ports:

```bash
AGENTMEMORY_REST_PORT=3611 AGENTMEMORY_VIEWER_PORT=3613 docker compose up --build -d
```

Open `http://127.0.0.1:3613`, use the persisted secret in `docker compose exec agentmemory cat /data/secret`, and stop with `docker compose down`. `docker compose down -v` deletes the memories and secret. Set `III_VERSION`, `STATE_VERSION`, `HTTP_VERSION`, and `AGENTMEMORY_VERSION` to override the central defaults.

## Platform templates

- [Fly.io](fly/README.md) — separate HTTPS listeners for REST (`3111`) and the bearer-protected viewer (`8443` externally → `3113` internally); a 1 GB persistent volume.
- [Railway](railway/README.md) — REST is the default public HTTP service; add a TCP proxy for viewer port `3113` if needed.
- [Render](render/README.md) — REST Web Service with a persistent disk; viewer is reachable only from an SSH tunnel unless you add a separately protected proxy.
- [Coolify](coolify/README.md) — both container ports are exposed only to the proxy network; use the Coolify domain with TLS and bearer authorization.

For any public viewer host, configure the allowed host/origin values to the actual domain. Do not publish a bearer-protected viewer over plain HTTP on an untrusted network. The viewer page itself is public; data/API proxy requests require the bearer.

## Updating and backing up

Change the pins in `deploy/Dockerfile`, rebuild and redeploy, and keep the platform's `/data` volume attached. Back up `/data` before upgrades and before any `down -v`, volume deletion, or secret rotation. The worker cache and engine configuration persist alongside state so restarts do not lose data.
