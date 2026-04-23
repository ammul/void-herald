// discord.js — Discord client setup and message helper
const { Client, GatewayIntentBits, Partials } = require('discord.js');

const CHANNEL_ID = process.env.DISCORD_CHANNEL_ID;

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
  partials: [Partials.Channel],
});

/**
 * Login and return the ready client.
 */
async function connect() {
  client.on('error', (e) => console.error('[discord] client error:', e.message));
  client.on('warn',  (w) => console.warn('[discord] warn:', w));
  const ready = new Promise((resolve, reject) => {
    client.once('ready', resolve);
    setTimeout(() => reject(new Error('ready event timed out after 60s')), 60_000);
  });
  await client.login(process.env.DISCORD_TOKEN);
  await ready;
  console.log(`[discord] logged in as ${client.user.tag}`);
  return client;
}

/**
 * Get the dedicated bot channel.
 */
async function getBotChannel() {
  const ch = await client.channels.fetch(CHANNEL_ID);
  if (!ch) throw new Error(`Channel ${CHANNEL_ID} not found — check DISCORD_CHANNEL_ID`);
  return ch;
}

/**
 * Send a plain or code-block message to the bot channel.
 */
async function send(text) {
  const ch = await getBotChannel();
  // Discord message limit is 2000 chars
  const chunks = splitMessage(text, 1990);
  for (const chunk of chunks) {
    await ch.send(chunk);
  }
}

/**
 * Send a message as a reply to a specific message.
 */
async function reply(message, text) {
  const chunks = splitMessage(text, 1990);
  await message.reply(chunks[0]);
  for (const chunk of chunks.slice(1)) {
    await message.channel.send(chunk);
  }
}

/**
 * Split long text into Discord-safe chunks.
 */
function splitMessage(text, maxLen) {
  if (text.length <= maxLen) return [text];
  const chunks = [];
  let remaining = text;
  while (remaining.length > 0) {
    chunks.push(remaining.slice(0, maxLen));
    remaining = remaining.slice(maxLen);
  }
  return chunks;
}

/**
 * Wrap text in a Discord code block.
 */
function code(text, lang = '') {
  return `\`\`\`${lang}\n${text}\n\`\`\``;
}

module.exports = { client, connect, getBotChannel, send, reply, code };
