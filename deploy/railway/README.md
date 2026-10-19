# Railway

Deploy the repository and set the service Config-as-Code path to `deploy/railway/railway.json`. Add a persistent volume mounted at `/data` before starting the service. The Railway service builds the shared `deploy/Dockerfile` and runs iii 0.24.6 Worker Compose and serves the health endpoint at `/agentmemory/livez`.

The REST API listens on `3111`; Railway's generated HTTP domain exposes that service. Read the secret with `railway ssh --service agentmemory -- 'cat /data/secret'` and send it as `Authorization: Bearer <secret>`.

The viewer listens on `3113`. Keep it private unless you put a TLS-terminating reverse proxy in front of it. Do not expose a raw TCP proxy for `3113` to the public internet: viewer API/SSE proxy calls carry the bearer token. If using a TLS proxy, configure `VIEWER_ALLOWED_HOSTS` and `VIEWER_ALLOWED_ORIGINS` with its exact host and origin, then enter the bearer in the viewer prompt. Viewer API/SSE proxy routes require bearer auth. Do not expose `49134`.

Keep the volume attached when redeploying. Back up `/data` before upgrades; Railway volumes do not automatically provide a portable backup.
