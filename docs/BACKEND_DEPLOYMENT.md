# PodPilot Backend Deployment

This guide prepares the FastAPI backend for `https://api.podpilot.space` on a Hetzner VPS running Ubuntu 24.04. The frontend stays on `https://podpilot.space`.

Do not commit production secrets. Keep the real backend env file only on the server.

## Target Architecture

- VPS: Hetzner Ubuntu 24.04
- Backend: FastAPI with `uvicorn app.main:app`
- Backend bind address: `127.0.0.1:8000`
- Reverse proxy: Caddy
- Public API URL: `https://api.podpilot.space`
- Frontend origin: `https://podpilot.space`
- Paddle webhook URL, after health check works: `https://api.podpilot.space/api/paddle/webhook`

## 1. Create The VPS

Create an Ubuntu 24.04 Hetzner VPS. Add your SSH key during server creation when possible.

After the server is available:

```bash
ssh root@YOUR_SERVER_IP
apt update && apt upgrade -y
```

Create a non-root app user:

```bash
adduser --disabled-password --gecos "" podpilot
usermod -aG sudo podpilot
```

## 2. Install System Packages

```bash
apt install -y git python3 python3-venv python3-pip curl ufw
apt install -y debian-keyring debian-archive-keyring apt-transport-https
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | tee /etc/apt/sources.list.d/caddy-stable.list
apt update
apt install -y caddy
```

Open SSH, HTTP, and HTTPS:

```bash
ufw allow OpenSSH
ufw allow 80/tcp
ufw allow 443/tcp
ufw --force enable
```

## 3. Clone The Repo

```bash
mkdir -p /opt/podpilot
chown -R podpilot:podpilot /opt/podpilot
sudo -u podpilot git clone https://github.com/ugvcryiukl/podpilot.git /opt/podpilot/current
cd /opt/podpilot/current
sudo -u podpilot git checkout codex/new-feature
```

## 4. Create The Backend Env File

Create a server-only env file:

```bash
mkdir -p /etc/podpilot
nano /etc/podpilot/backend.env
chmod 600 /etc/podpilot/backend.env
chown root:root /etc/podpilot/backend.env
```

Use `backend/.env.production.example` as the shape, but put the real values only in `/etc/podpilot/backend.env`.

Security reminders:

- Never commit `PADDLE_API_KEY`.
- Never commit `PADDLE_WEBHOOK_SECRET`.
- Never commit `SUPABASE_SERVICE_ROLE_KEY`.
- Never commit R2 secrets.
- Never commit real `.env` files.

For production CORS, use:

```env
ALLOWED_ORIGINS=https://podpilot.space
```

### Paddle Price Environment Checklist

Fill the real Paddle price IDs only in `/etc/podpilot/backend.env` on the
server. Do not commit real Paddle IDs to Git.

Subscription checkout uses trial eligibility to select the price:

- Trial eligible users receive the matching `*_TRIAL_PRICE_ID`.
- Users who are not trial eligible receive the matching normal no-trial
  `*_PRICE_ID`.
- AI listing credit packs are one-time prices and never use trial prices.

Required subscription price variables:

```env
# 3-day trial prices
PADDLE_REDBUBBLE_MONTHLY_TRIAL_PRICE_ID=YOUR_REDBUBBLE_MONTHLY_TRIAL_PRICE_ID
PADDLE_REDBUBBLE_ANNUAL_TRIAL_PRICE_ID=YOUR_REDBUBBLE_ANNUAL_TRIAL_PRICE_ID
PADDLE_TEEPUBLIC_MONTHLY_TRIAL_PRICE_ID=YOUR_TEEPUBLIC_MONTHLY_TRIAL_PRICE_ID
PADDLE_TEEPUBLIC_ANNUAL_TRIAL_PRICE_ID=YOUR_TEEPUBLIC_ANNUAL_TRIAL_PRICE_ID
PADDLE_ALL_PLATFORMS_MONTHLY_TRIAL_PRICE_ID=YOUR_ALL_PLATFORMS_MONTHLY_TRIAL_PRICE_ID
PADDLE_ALL_PLATFORMS_ANNUAL_TRIAL_PRICE_ID=YOUR_ALL_PLATFORMS_ANNUAL_TRIAL_PRICE_ID

# Normal no-trial prices
PADDLE_REDBUBBLE_MONTHLY_PRICE_ID=YOUR_REDBUBBLE_MONTHLY_PRICE_ID
PADDLE_REDBUBBLE_ANNUAL_PRICE_ID=YOUR_REDBUBBLE_ANNUAL_PRICE_ID
PADDLE_TEEPUBLIC_MONTHLY_PRICE_ID=YOUR_TEEPUBLIC_MONTHLY_PRICE_ID
PADDLE_TEEPUBLIC_ANNUAL_PRICE_ID=YOUR_TEEPUBLIC_ANNUAL_PRICE_ID
PADDLE_ALL_PLATFORMS_MONTHLY_PRICE_ID=YOUR_ALL_PLATFORMS_MONTHLY_PRICE_ID
PADDLE_ALL_PLATFORMS_ANNUAL_PRICE_ID=YOUR_ALL_PLATFORMS_ANNUAL_PRICE_ID
```

Required AI listing credit pack variables:

```env
PADDLE_AI_TOKENS_250_PRICE_ID=YOUR_AI_TOKENS_250_PRICE_ID
PADDLE_AI_TOKENS_500_PRICE_ID=YOUR_AI_TOKENS_500_PRICE_ID
PADDLE_AI_TOKENS_1000_PRICE_ID=YOUR_AI_TOKENS_1000_PRICE_ID
PADDLE_AI_TOKENS_2500_PRICE_ID=YOUR_AI_TOKENS_2500_PRICE_ID
PADDLE_AI_TOKENS_5000_PRICE_ID=YOUR_AI_TOKENS_5000_PRICE_ID
PADDLE_AI_TOKENS_10000_PRICE_ID=YOUR_AI_TOKENS_10000_PRICE_ID
```

Legacy compatibility variables may remain blank for a new production setup:

```env
PADDLE_REDBUBBLE_PRICE_ID=
PADDLE_TEEPUBLIC_PRICE_ID=
PADDLE_ALL_PLATFORMS_PRICE_ID=
PADDLE_REDBUBBLE_PAID_PRICE_ID=
PADDLE_TEEPUBLIC_PAID_PRICE_ID=
PADDLE_ALL_PLATFORMS_PAID_PRICE_ID=
```

## 5. Install Backend Requirements

```bash
cd /opt/podpilot/current/backend
sudo -u podpilot python3 -m venv .venv
sudo -u podpilot .venv/bin/pip install --upgrade pip
sudo -u podpilot .venv/bin/pip install -r requirements.txt
```

## 6. Configure systemd

Copy the service example:

```bash
cp /opt/podpilot/current/deploy/podpilot-backend.service.example /etc/systemd/system/podpilot-backend.service
systemctl daemon-reload
systemctl enable podpilot-backend
systemctl start podpilot-backend
systemctl status podpilot-backend --no-pager
```

View logs:

```bash
journalctl -u podpilot-backend -f
```

The service runs:

```bash
uvicorn app.main:app --host 127.0.0.1 --port 8000 --proxy-headers --forwarded-allow-ips=127.0.0.1
```

## 7. Configure Caddy

Copy the Caddy example:

```bash
cp /opt/podpilot/current/deploy/Caddyfile.example /etc/caddy/Caddyfile
caddy validate --config /etc/caddy/Caddyfile
systemctl reload caddy
systemctl status caddy --no-pager
```

Caddy proxies `api.podpilot.space` to `127.0.0.1:8000` and manages TLS certificates automatically.

## 8. Configure Cloudflare DNS

In Cloudflare DNS for `podpilot.space`, create:

- Type: `A`
- Name: `api`
- IPv4 address: your Hetzner VPS IP
- Proxy status: Proxied or DNS only. If TLS/debugging is difficult, start with DNS only, verify, then enable proxy.

Wait for DNS to propagate.

## 9. Test Health

On the server:

```bash
curl -i http://127.0.0.1:8000/healthz
```

From your local machine:

```bash
curl -i https://api.podpilot.space/healthz
```

Only continue when `https://api.podpilot.space/healthz` returns HTTP 200.

## 10. Create Paddle Webhook Last

After the public health check works, create the Paddle webhook:

```text
https://api.podpilot.space/api/paddle/webhook
```

Then copy the webhook signing secret into `/etc/podpilot/backend.env` as `PADDLE_WEBHOOK_SECRET`, restart the backend, and test a Paddle event:

```bash
systemctl restart podpilot-backend
journalctl -u podpilot-backend -f
```

## Deploy Updates

```bash
cd /opt/podpilot/current
sudo -u podpilot git fetch origin
sudo -u podpilot git checkout codex/new-feature
sudo -u podpilot git pull --ff-only origin codex/new-feature
cd backend
sudo -u podpilot .venv/bin/pip install -r requirements.txt
systemctl restart podpilot-backend
```

Re-test:

```bash
curl -i https://api.podpilot.space/healthz
```
