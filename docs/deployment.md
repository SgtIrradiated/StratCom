# Deployment (self-hosting)

StratCom ships as one Docker image (Node: client, API, and later the game relay) behind
[Caddy](https://caddyserver.com), which handles HTTPS automatically.

```
Internet ──443──▶ Caddy (TLS, compression) ──8080──▶ stratcom (Node)
```

## Requirements

- A Linux server with at least 1 vCPU and 1 GB RAM (more for many concurrent matches later)
- Docker Engine with the Compose plugin (`docker compose version`)
- A domain or subdomain whose DNS **A/AAAA record** points to the server
- Ports **80** and **443** (TCP and UDP) open. Caddy needs port 80 for the Let's Encrypt
  challenge

## First deployment

```sh
git clone <your-repo-url> stratcom && cd stratcom
cp .env.example deploy/.env
#   edit deploy/.env and set STRATCOM_DOMAIN=game.example.com
docker compose -f deploy/docker-compose.yml up -d --build
```

Check it:

```sh
docker compose -f deploy/docker-compose.yml ps        # both services "running", stratcom "healthy"
curl -s https://game.example.com/healthz              # {"status":"ok",...}
```

Open `https://game.example.com`. The boot panel should report `Cross-origin isolated: yes`.

## Updating

```sh
git pull
docker compose -f deploy/docker-compose.yml up -d --build
```

The client's hashed assets are cached forever and `index.html` is always revalidated, so
players pick up the new build on their next page load.

## Operations

| Task             | Command                                                        |
| ---------------- | -------------------------------------------------------------- |
| Logs (JSON)      | `docker compose -f deploy/docker-compose.yml logs -f stratcom` |
| Restart          | `docker compose -f deploy/docker-compose.yml restart stratcom` |
| Stop everything  | `docker compose -f deploy/docker-compose.yml down`             |
| Change log level | set `LOG_LEVEL=debug` in `deploy/.env`, then `up -d`           |

**Back up the `caddy_data` volume.** It holds your TLS certificates and account keys. From M8
(replays, lobby state), a data volume for the server will also need backing up. This guide
will be updated then.

## Local trial run

Leave `STRATCOM_DOMAIN=localhost`. Caddy then serves `https://localhost` with a self-signed
certificate. Your browser will warn once.

## Troubleshooting

| Symptom                                     | Likely cause                                                                       |
| ------------------------------------------- | ---------------------------------------------------------------------------------- |
| Caddy logs `challenge failed`               | DNS doesn't point at the server yet, or port 80 is blocked                         |
| `stratcom` stays `unhealthy`                | `docker compose logs stratcom`. An invalid env var is reported by name at start-up |
| Boot panel says `Cross-origin isolated: no` | A proxy in front of Caddy (such as a CDN) is stripping the COOP/COEP headers       |
| WebGL2 error in the browser                 | Hardware acceleration is disabled in the browser, or the drivers are too old       |
