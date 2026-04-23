// github-webhook.js — receives GitHub Actions webhook and posts to Discord
const crypto  = require('crypto');
const express = require('express');
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

const MAX_BODY = 25 * 1024; // 25KB — GitHub payloads are typically <10KB

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

function registerWebhook(app) {
  app.post('/github-webhook', rawBodyMiddleware, async (req, res) => {
    if (!verifySignature(req, req.rawBody)) {
      console.warn('[webhook] invalid signature — ignoring');
      return res.status(401).send('Invalid signature');
    }

    res.status(200).send('ok'); // Respond fast; Discord send is async

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
  const run    = payload.workflow_run;
  if (!run) return;

  const repo   = payload.repository?.full_name ?? 'unknown/repo';
  const name   = run.name ?? 'Workflow';
  const branch = run.head_branch ?? 'unknown';
  const url    = run.html_url ?? '';
  const actor  = run.triggering_actor?.login ?? 'unknown';

  if (run.status === 'in_progress' && run.run_attempt === 1) {
    await send(
      `🚀 **Pipeline started**\n` +
      `**Repo:** ${repo}  |  **Workflow:** ${name}\n` +
      `**Branch:** \`${branch}\`  |  **By:** ${actor}\n` +
      url
    );
  } else if (run.status === 'completed') {
    const icon       = run.conclusion === 'success' ? '✅' : '❌';
    const conclusion = run.conclusion ?? 'unknown';
    const duration   = run.updated_at && run.run_started_at
      ? Math.round((new Date(run.updated_at) - new Date(run.run_started_at)) / 1000) + 's'
      : '?';

    await send(
      `${icon} **Pipeline ${conclusion}**\n` +
      `**Repo:** ${repo}  |  **Workflow:** ${name}\n` +
      `**Branch:** \`${branch}\`  |  **Duration:** ${duration}\n` +
      url
    );
  }
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
