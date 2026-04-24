// github-webhook.js — receives GitHub Actions webhook and posts to Discord
const crypto  = require('crypto');
const https   = require('https');
const { send } = require('./discord');

const SECRET = process.env.GITHUB_WEBHOOK_SECRET;

function verifySignature(req, rawBody) {
  const sig = req.headers['x-hub-signature-256'];
  if (!sig) return false;
  const expected = 'sha256=' + crypto
    .createHmac('sha256', SECRET)
    .update(rawBody)
    .digest('hex');
  try {
    return crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected));
  } catch {
    return false;
  }
}

const MAX_BODY = 25 * 1024;

function rawBodyMiddleware(req, res, next) {
  let data = '';
  req.setEncoding('utf8');
  req.on('data', chunk => { data += chunk; });
  req.on('end', () => {
    if (Buffer.byteLength(data) > MAX_BODY) return res.status(413).send('Payload too large');
    req.rawBody = data;
    try { req.body = JSON.parse(data); } catch { req.body = {}; }
    next();
  });
}

// Dedup: tracks seen event keys for 5 minutes to prevent double-posting
const seenEvents = new Map();
function isDuplicate(key) {
  const now = Date.now();
  for (const [k, ts] of seenEvents) {
    if (now - ts > 5 * 60_000) seenEvents.delete(k);
  }
  if (seenEvents.has(key)) return true;
  seenEvents.set(key, now);
  return false;
}

function registerWebhook(app) {
  app.post('/github-webhook', rawBodyMiddleware, async (req, res) => {
    if (!verifySignature(req, req.rawBody)) {
      console.warn('[webhook] invalid signature — ignoring');
      return res.status(401).send('Invalid signature');
    }

    res.status(200).send('ok');

    const event   = req.headers['x-github-event'];
    const payload = req.body;

    try {
      if (event === 'workflow_run') {
        await handleWorkflowRun(payload);
      } else if (event === 'push') {
        await handlePush(payload);
      }
    } catch (err) {
      console.error('[webhook] error handling event:', err.message);
    }
  });
}

async function handleWorkflowRun(payload) {
  const run = payload.workflow_run;
  if (!run) return;

  const repo   = payload.repository?.full_name ?? 'unknown/repo';
  const name   = run.name ?? 'Workflow';
  const branch = run.head_branch ?? 'unknown';
  const url    = run.html_url ?? '';
  const actor  = run.triggering_actor?.login ?? 'unknown';
  const runId  = run.id;

  if (run.status === 'in_progress' && run.run_attempt === 1) {
    if (isDuplicate(`${runId}-started`)) return;
    await send(
      `🚀 **Pipeline started**\n` +
      `**Repo:** ${repo}  |  **Workflow:** ${name}\n` +
      `**Branch:** \`${branch}\`  |  **By:** ${actor}\n` +
      url
    );
    return;
  }

  if (run.status !== 'completed') return;

  const duration = run.updated_at && run.run_started_at
    ? Math.round((new Date(run.updated_at) - new Date(run.run_started_at)) / 1000) + 's'
    : '?';

  if (run.conclusion === 'failure') {
    if (isDuplicate(`${runId}-failed`)) return;
    let failDetail = '';
    const token = process.env.GITHUB_TOKEN;
    if (token) {
      try {
        failDetail = await fetchFailedStep(repo, runId, token);
      } catch (err) {
        console.warn('[webhook] could not fetch failed step:', err.message);
      }
    }
    await send(
      `❌ **Pipeline failed**\n` +
      `**Repo:** ${repo}  |  **Workflow:** ${name}\n` +
      `**Branch:** \`${branch}\`  |  **Duration:** ${duration}\n` +
      (failDetail ? `**Failed step:** ${failDetail}\n` : '') +
      url
    );
    return;
  }

  if (run.conclusion === 'success') {
    if (isDuplicate(`${runId}-finished`)) return;
    await send(
      `✅ **Pipeline finished**\n` +
      `**Repo:** ${repo}  |  **Workflow:** ${name}\n` +
      `**Branch:** \`${branch}\`  |  **Duration:** ${duration}\n` +
      url
    );
    return;
  }
  // Other conclusions (cancelled, skipped, neutral, etc.) are ignored
}

function fetchFailedStep(repo, runId, token) {
  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname: 'api.github.com',
      path:     `/repos/${repo}/actions/runs/${runId}/jobs`,
      method:   'GET',
      headers:  {
        'Authorization':        `Bearer ${token}`,
        'Accept':               'application/vnd.github+json',
        'User-Agent':           'void-herald-bot/1.0',
        'X-GitHub-Api-Version': '2022-11-28',
      },
    }, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', chunk => { body += chunk; });
      res.on('end', () => {
        if (res.statusCode !== 200) {
          reject(new Error(`GitHub API ${res.statusCode}`));
          return;
        }
        try {
          const data = JSON.parse(body);
          for (const job of (data.jobs ?? [])) {
            if (job.conclusion === 'failure') {
              for (const step of (job.steps ?? [])) {
                if (step.conclusion === 'failure') {
                  resolve(`**${job.name}** › ${step.name}`);
                  return;
                }
              }
              resolve(`**${job.name}** (step unknown)`);
              return;
            }
          }
          resolve('unknown step');
        } catch {
          reject(new Error('Failed to parse GitHub API response'));
        }
      });
    });
    req.setTimeout(8000, () => { req.destroy(); reject(new Error('GitHub API timeout')); });
    req.on('error', reject);
    req.end();
  });
}

async function handlePush(payload) {
  const repo    = payload.repository?.full_name ?? 'unknown/repo';
  const branch  = payload.ref?.replace('refs/heads/', '') ?? 'unknown';
  const pusher  = payload.pusher?.name ?? 'unknown';
  const commits = (payload.commits ?? []).length;

  await send(
    `📦 **Push to ${repo}**\n` +
    `**Branch:** \`${branch}\`  |  **By:** ${pusher}  |  **Commits:** ${commits}`
  );
}

module.exports = { registerWebhook };
