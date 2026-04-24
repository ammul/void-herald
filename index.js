// index.js — Discord Git Bot entry point
require('dotenv').config();

const express           = require('express');
const { client, connect, send, reply, code } = require('./discord');
const { runClaudeCode, runClaudeCodePlan }   = require('./claude');
const { getRepoStatus } = require('./git');
const { registerWebhook } = require('./github-webhook');
const { getResponse, IS_NAUGHTY } = require('./mood');
const { checkQuota, recordCost, EFFECTIVE_LIMIT } = require('./quota');

const PREFIX     = process.env.PREFIX ?? '!';
const CHANNEL_ID = process.env.DISCORD_CHANNEL_ID;
const PORT       = parseInt(process.env.PORT ?? '3000', 10);
const ALLOWED_IDS = (process.env.ALLOWED_USER_IDS ?? '')
  .split(',').map(s => s.trim()).filter(Boolean);

if (ALLOWED_IDS.length === 0)
  console.warn('[bot] WARNING: ALLOWED_USER_IDS is not set — all users will be rejected');

// ── Express (GitHub webhook) ─────────────────────────────────────────────────
const app = express();
registerWebhook(app);
app.get('/health', (_req, res) => res.json({ status: 'ok', uptime: process.uptime() }));
app.listen(PORT, () => console.log(`[bot] HTTP server on :${PORT}`));

let busy = false;

// ── Discord event: message ───────────────────────────────────────────────────
client.on('messageCreate', async (message) => {
  if (message.author.bot) return;
  if (message.channelId !== CHANNEL_ID) return;

  // ── User allowlist (deny-by-default) ────────────────────────────────────
  if (!ALLOWED_IDS.includes(message.author.id)) {
    await reply(message, getResponse('unauthorized'));
    return;
  }

  const content = message.content.trim();
  if (!content.startsWith(PREFIX)) return;

  const task    = content.slice(PREFIX.length).trim();
  const [command] = task.split(/\s+/);

  // ── !help ────────────────────────────────────────────────────────────────
  if (command === 'help') {
    if (IS_NAUGHTY) {
      await reply(message, getResponse('help', { prefix: PREFIX }));
    } else {
      await reply(message,
        `🤖 **Discord Git Bot** (powered by Claude Code)\n\n` +
        `Describe any task in plain English after \`${PREFIX}\`:\n` +
        `> \`${PREFIX}add a README and commit\`\n` +
        `> \`${PREFIX}fix the typo in main.js line 5\`\n` +
        `> \`${PREFIX}show the last 5 commits\`\n\n` +
        `**Special commands:**\n` +
        `\`${PREFIX}help\` — this message\n` +
        `\`${PREFIX}status\` — current repo status\n` +
        `\`${PREFIX}plan <task>\` — plan without executing`
      );
    }
    return;
  }

  // ── !status ──────────────────────────────────────────────────────────────
  if (command === 'status') {
    await reply(message, getResponse('status', { content: code(getRepoStatus(), 'bash') }));
    return;
  }

  // ── !plan <task> — Claude Code in plan-only mode ─────────────────────────
  if (command === 'plan') {
    const planTask = task.replace(/^plan\s+/, '').trim();
    if (!planTask) {
      await reply(message, getResponse('empty_task', { prefix: PREFIX }));
      return;
    }
    if (busy) {
      await reply(message, getResponse('busy'));
      return;
    }
    busy = true;
    const planMsg  = await message.reply(getResponse('plan_start'));
    const planStart = Date.now();
    const planTimer = setInterval(async () => {
      const elapsed = Math.floor((Date.now() - planStart) / 60_000);
      try { await planMsg.edit(getResponse('working', { elapsed })); } catch {}
    }, 60_000);

    let planResult;
    try {
      planResult = await runClaudeCodePlan(planTask, getRepoStatus());
    } catch (err) {
      clearInterval(planTimer);
      console.error('[bot] plan error:', err.message);
      await reply(message, getResponse('error', { content: `\`${err.message}\`` }));
      busy = false;
      return;
    }
    clearInterval(planTimer);
    busy = false;

    await reply(message,
      planResult.success
        ? getResponse('plan_complete', { content: truncate(planResult.output) })
        : getResponse('error', { content: code(truncate(planResult.output), 'bash') })
    );
    return;
  }

  // ── Natural language task → Claude Code ─────────────────────────────────
  if (!task) {
    await reply(message, getResponse('empty_task', { prefix: PREFIX }));
    return;
  }

  if (busy) {
    await reply(message, getResponse('busy'));
    return;
  }

  // Quota check
  if (EFFECTIVE_LIMIT !== Infinity) {
    const q = checkQuota();
    if (!q.allowed) {
      await reply(message, getResponse('quota_exhausted', {
        used:    q.used.toFixed(4),
        limit:   q.limit.toFixed(4),
        minutes: q.minutesUntilReset,
      }));
      return;
    }
  }

  busy = true;
  const workingMsg = await message.reply(getResponse('working', { elapsed: 0 }));
  const start = Date.now();
  const progress = setInterval(async () => {
    const elapsed = Math.floor((Date.now() - start) / 60_000);
    try { await workingMsg.edit(getResponse('working', { elapsed })); } catch {}
  }, 60_000);

  let result;
  try {
    result = await runClaudeCode(task, getRepoStatus());
  } catch (err) {
    clearInterval(progress);
    console.error('[bot] claude error:', err.message);
    await reply(message, getResponse('error', { content: `\`${err.message}\`` }));
    busy = false;
    return;
  }
  clearInterval(progress);
  busy = false;

  // Record cost and report quota status
  if (result.cost_usd > 0 && EFFECTIVE_LIMIT !== Infinity) {
    const after   = recordCost(result.cost_usd);
    const pctUsed = after.used / after.limit;
    const category = pctUsed >= 0.8 ? 'quota_warning' : 'quota_status';
    await reply(message, getResponse(category, {
      used:      after.used.toFixed(4),
      limit:     after.limit.toFixed(4),
      remaining: after.remaining.toFixed(4),
    }));
  }

  if (!result.success && isRateLimitError(result.output)) {
    await reply(message, getResponse('rate_limited'));
    return;
  }

  await reply(message,
    result.success
      ? getResponse('success', { content: code(truncate(result.output), 'md') })
      : getResponse('error',   { content: code(truncate(result.output), 'bash') })
  );
});

// ── Boot ─────────────────────────────────────────────────────────────────────
(async () => {
  await connect();
  try {
    await send(getResponse('startup'));
  } catch (err) {
    console.error('[bot] could not send startup message:', err.message);
  }
})();

function truncate(str, max = 1800) {
  return str.length <= max ? str : str.slice(0, max) + '\n... (truncated)';
}

function isRateLimitError(output) {
  return /usage limit|rate.?limit|quota exceeded|too many requests|out of credits/i.test(output ?? '');
}
