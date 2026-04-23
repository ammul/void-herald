# void-herald

Control a local git repository from Discord using natural language, powered by [Claude Code](https://claude.ai/code). GitHub Actions pipeline notifications are posted back to the same channel.

```
you:  !add a README and push to main
bot:  ✅ Done!
      $ git add README.md
      $ git commit -m "Add README"
      $ git push origin main
      ✓ Done
```

## Architecture

```
Discord channel
      │  !<task>
      ▼
  index.js  ──────────────────────────────────────────────┐
      │                                                    │
      ▼                                                    ▼
  claude.js                                      github-webhook.js
  (spawns: claude --print -p <prompt>)           (Express :3000)
      │                                                    ▲
      ▼                                                    │
  git repo on disk                            ngrok tunnel (public URL)
                                                           │
                                                  GitHub Actions webhook
```

---

## Prerequisites

| Requirement | Notes |
|---|---|
| Node.js ≥ 18 | `node --version` |
| [Claude Code](https://claude.ai/code) | Installed and authenticated (`claude auth`) |
| [ngrok](https://ngrok.com) | Free account with a static domain |
| A git repository | Already cloned on this machine |
| A Discord account | To create the bot application |

---

## Setup

### 1. Create a Discord bot

1. Go to https://discord.com/developers/applications → **New Application**
2. **Bot** → **Reset Token** → copy the token
3. **Bot** → **Privileged Gateway Intents** → enable **Message Content Intent**
4. **OAuth2** → **URL Generator**:
   - Scopes: ✅ `bot`
   - Bot Permissions: ✅ Send Messages, ✅ Read Message History, ✅ View Channels
5. Open the generated URL in your browser and invite the bot to your server
6. In your server: right-click your bot channel → **Copy Channel ID**
   *(Enable Developer Mode first: User Settings → Advanced → Developer Mode)*
7. To get your own Discord user ID: right-click your username → **Copy User ID**

### 2. Claim a free ngrok static domain

1. Sign up at https://ngrok.com and install ngrok
2. `ngrok config add-authtoken <your-token>`
3. Dashboard → **Cloud Edge → Domains → + New Domain** → copy the domain

### 3. Configure environment

```bash
cp .env.example .env
```

Edit `.env`:

| Variable | Where to find it |
|---|---|
| `DISCORD_TOKEN` | Discord Developer Portal → Bot → Token |
| `DISCORD_CHANNEL_ID` | Right-click bot channel → Copy Channel ID |
| `CLAUDE_BIN` | Output of `which claude` |
| `REPO_PATH` | Absolute path to your local git repo |
| `GITHUB_WEBHOOK_SECRET` | `openssl rand -hex 32` |
| `PUBLIC_URL` | `https://<your-ngrok-domain>` |
| `ALLOWED_USER_IDS` | Your Discord user ID (comma-separated for multiple) |

### 4. Install dependencies

```bash
npm install
```

### 5. Test manually

```bash
node index.js
```

Expected output:
```
[bot] HTTP server on :3000
[discord] logged in as YourBot#1234
```

The bot posts an online message in your channel. Test `!help` and `!status` in Discord, then Ctrl+C.

### 6. Install as systemd services

```bash
# Edit systemd/ngrok.service — replace YOUR_STATIC_DOMAIN with your ngrok domain
# void-herald.service is already configured for /home/cedric

sudo cp systemd/ngrok.service /etc/systemd/system/
sudo cp systemd/void-herald.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now ngrok void-herald
sudo systemctl status ngrok void-herald
```

### 7. Add GitHub Actions webhook

Repo → **Settings** → **Webhooks** → **Add webhook**:

| Field | Value |
|---|---|
| Payload URL | `https://<your-ngrok-domain>/github-webhook` |
| Content type | `application/json` |
| Secret | Value of `GITHUB_WEBHOOK_SECRET` from `.env` |
| Events | Workflow runs ✅, Pushes ✅ (optional) |

### 8. Reboot test

```bash
sudo reboot
# After reboot:
sudo systemctl status ngrok void-herald
```

Both should show `active (running)`. The bot posts an online message in Discord.

---

## Usage

| Command | Result |
|---|---|
| `!help` | Show usage |
| `!status` | Repo branch, changes, recent commits |
| `!add a README and commit` | Claude plans and executes the task |
| `!fix the typo in main.js line 5` | Claude edits the file and commits |
| `!show the last 5 commits` | Runs git log, replies with output |
| `!push to origin main` | Claude runs the push |

The bot rejects new requests while a task is running and updates the "Working on it..." message with elapsed time for long tasks.

---

## Security

### Data flow

```
User (Discord)
  │  Message content
  │  Authenticated by: Discord user ID allowlist (ALLOWED_USER_IDS)
  ▼
index.js
  │  Prompt string (task + repo status)
  │  No secrets passed to subprocess
  ▼
claude CLI process
  │  Constrained to: REPO_PATH only
  │  Tools: Bash(git *), Bash(ls *), Read, Edit, Write
  │  Calls Anthropic API over HTTPS
  ▼
git repo on disk

GitHub → ngrok tunnel → github-webhook.js
  │  Authenticated by: HMAC-SHA256 signature (GITHUB_WEBHOOK_SECRET)
  │  Body size limited to 25KB
  ▼
Discord channel (notification only, read-only)
```

### Authentication layers

| Layer | Mechanism |
|---|---|
| Discord commands | `ALLOWED_USER_IDS` allowlist — unlisted users are rejected before any processing |
| GitHub webhook | HMAC-SHA256 signature verified with `crypto.timingSafeEqual` — invalid requests return 401 |
| ngrok tunnel | Public URL, but the webhook endpoint only accepts signed GitHub payloads |

### What Claude can access

- **File system:** Read, Edit, Write are unrestricted by path in the Claude tool layer, but the subprocess is instructed via system prompt to only operate within `REPO_PATH`
- **Shell:** Only `git *` and `ls *` commands — no curl, wget, sudo, rm -rf, etc.
- **Network:** Claude calls the Anthropic API directly; it cannot reach other services via the allowed tools
- **Secrets:** `DISCORD_TOKEN` and `GITHUB_WEBHOOK_SECRET` are stripped from the Claude subprocess environment

### Secrets

| Secret | Stored in | Used for |
|---|---|---|
| `DISCORD_TOKEN` | `.env` (never committed) | Bot authenticates to Discord gateway |
| `GITHUB_WEBHOOK_SECRET` | `.env` (never committed) | Verifying GitHub webhook signatures |
| `ALLOWED_USER_IDS` | `.env` (never committed) | Restricting who can issue commands |

The `.env` file is in `.gitignore` and must never be committed.

### Threat model

This bot is designed for **single-user personal use**. It is not hardened for multi-tenant or production environments. Key assumptions:

- The machine running the bot is trusted
- All users in `ALLOWED_USER_IDS` are fully trusted — they can instruct Claude to run arbitrary git operations and modify files within `REPO_PATH`
- The ngrok tunnel is a temporary exposure — it should be disabled when not needed if the bot is not running as a service
