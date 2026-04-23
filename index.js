// index.js — Discord Git Bot entry point
require('dotenv').config();

const express           = require('express');
const { client, connect, send, reply, code } = require('./discord');
const { runClaudeCode } = require('./claude');
const { getRepoStatus } = require('./git');
const { registerWebhook } = require('./github-webhook');

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
    await reply(message, '⛔ You are not authorised to use this bot.');
    return;
  }

  const content = message.content.trim();
  if (!content.startsWith(PREFIX)) return;

  const task = content.slice(PREFIX.length).trim();
  const [command] = task.split(/\s+/);

  // ── !help ────────────────────────────────────────────────────────────────
  if (command === 'help') {
    await reply(message,
      `🤖 **Discord Git Bot** (powered by Claude Code)\n\n` +
      `Describe any task in plain English after \`${PREFIX}\`:\n` +
      `> \`${PREFIX}add a README and commit\`\n` +
      `> \`${PREFIX}fix the typo in main.js line 5\`\n` +
      `> \`${PREFIX}show the last 5 commits\`\n\n` +
      `**Special commands:**\n` +
      `\`${PREFIX}help\` — this message\n` +
      `\`${PREFIX}status\` — current repo status`
    );
    return;
  }

  // ── !status ──────────────────────────────────────────────────────────────
  if (command === 'status') {
    await reply(message, `📊 **Repo Status**\n${code(getRepoStatus(), 'bash')}`);
    return;
  }

  // ── Natural language task → Claude Code ─────────────────────────────────
  if (!task) {
    await reply(message, `Please describe a task after \`${PREFIX}\`. Try \`${PREFIX}help\`.`);
    return;
  }

  if (busy) {
    await reply(message, '⏳ Already working on a task. Please wait until it finishes.');
    return;
  }

  busy = true;
  const workingMsg = await message.reply('🤔 Working on it...');
  const start = Date.now();
  const progress = setInterval(async () => {
    const elapsed = Math.floor((Date.now() - start) / 60_000);
    try { await workingMsg.edit(`🤔 Working on it... (${elapsed}m elapsed)`); } catch {}
  }, 60_000);

  let result;
  try {
    result = await runClaudeCode(task, getRepoStatus());
  } catch (err) {
    clearInterval(progress);
    console.error('[bot] claude error:', err.message);
    await reply(message, `❌ Claude Code error: \`${err.message}\``);
    busy = false;
    return;
  }
  clearInterval(progress);
  busy = false;

  await reply(message,
    result.success
      ? `✅ **Done!**\n${code(truncate(result.output), 'md')}`
      : `❌ **Failed**\n${code(truncate(result.output), 'bash')}`
  );
});

// ── Boot ─────────────────────────────────────────────────────────────────────
(async () => {
  await connect();
  try {
    await send(`🤖 Discord Git Bot is online! Type \`${PREFIX}help\` to get started.`);
  } catch (err) {
    console.error('[bot] could not send startup message:', err.message);
  }
})();

function truncate(str, max = 1800) {
  return str.length <= max ? str : str.slice(0, max) + '\n... (truncated)';
}
