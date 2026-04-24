// quota.js — session-aligned cost tracker; persists state across restarts
const fs   = require('fs');
const path = require('path');

const STATE_FILE    = path.join(__dirname, '.quota-state.json');
const WINDOW_HOURS  = parseFloat(process.env.QUOTA_WINDOW_HOURS  ?? '5');
const WINDOW_MS     = WINDOW_HOURS * 3_600_000;
const SESSION_USD   = parseFloat(process.env.QUOTA_SESSION_USD   ?? '0');
const SHARE_PCT     = parseFloat(process.env.QUOTA_SHARE_PCT     ?? '50');
const WINDOW_START  = process.env.QUOTA_WINDOW_START ?? '';  // "HH:MM" local time

const EFFECTIVE_LIMIT = SESSION_USD > 0 ? SESSION_USD * SHARE_PCT / 100 : Infinity;

/**
 * Returns { windowStart, windowEnd } timestamps for the current session window.
 * - Fixed mode (QUOTA_WINDOW_START set): aligns to the configured HH:MM start time.
 * - Rolling mode: window is [now - WINDOW_MS, now].
 */
function getWindowBounds() {
  const now = Date.now();
  if (!WINDOW_START) {
    return { windowStart: now - WINDOW_MS, windowEnd: now };
  }

  const [hh, mm] = WINDOW_START.split(':').map(Number);
  const candidate = new Date();
  candidate.setHours(hh, mm, 0, 0);

  // If today's start time is in the future, use yesterday's
  if (candidate.getTime() > now) {
    candidate.setDate(candidate.getDate() - 1);
  }

  const windowStart = candidate.getTime();
  const windowEnd   = windowStart + WINDOW_MS;
  return { windowStart, windowEnd };
}

function loadState() {
  const { windowStart, windowEnd } = getWindowBounds();
  const now = Date.now();

  // If window has fully expired, the session ended — treat as fresh
  if (WINDOW_START && now >= windowEnd) {
    return { entries: [] };
  }

  try {
    const data = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
    return { entries: (data.entries ?? []).filter(e => e.timestamp >= windowStart) };
  } catch {
    return { entries: [] };
  }
}

function saveState(state) {
  try {
    fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2), 'utf8');
  } catch (err) {
    console.error('[quota] could not persist state:', err.message);
  }
}

function windowTotal(entries) {
  return entries.reduce((sum, e) => sum + e.cost_usd, 0);
}

/**
 * @returns {{ allowed: boolean, used: number, limit: number, remaining: number, minutesUntilReset: number }}
 */
function checkQuota() {
  if (EFFECTIVE_LIMIT === Infinity) {
    return { allowed: true, used: 0, limit: Infinity, remaining: Infinity, minutesUntilReset: 0 };
  }
  const state     = loadState();
  const used      = windowTotal(state.entries);
  const remaining = Math.max(0, EFFECTIVE_LIMIT - used);

  let minutesUntilReset;
  if (WINDOW_START) {
    const { windowEnd } = getWindowBounds();
    minutesUntilReset = Math.max(0, Math.ceil((windowEnd - Date.now()) / 60_000));
  } else {
    // Rolling: reset when oldest entry exits the window
    const oldest = state.entries.length > 0
      ? Math.min(...state.entries.map(e => e.timestamp))
      : Date.now();
    minutesUntilReset = Math.ceil((oldest + WINDOW_MS - Date.now()) / 60_000);
  }

  return {
    allowed: used < EFFECTIVE_LIMIT,
    used:    parseFloat(used.toFixed(6)),
    limit:   parseFloat(EFFECTIVE_LIMIT.toFixed(6)),
    remaining: parseFloat(remaining.toFixed(6)),
    minutesUntilReset,
  };
}

/**
 * @param {number} cost_usd
 * @returns {{ used: number, limit: number, remaining: number }}
 */
function recordCost(cost_usd) {
  if (EFFECTIVE_LIMIT === Infinity) return { used: 0, limit: Infinity, remaining: Infinity };
  const state = loadState();
  state.entries.push({ timestamp: Date.now(), cost_usd });
  saveState(state);
  const used      = windowTotal(state.entries);
  const remaining = Math.max(0, EFFECTIVE_LIMIT - used);
  return {
    used:    parseFloat(used.toFixed(6)),
    limit:   parseFloat(EFFECTIVE_LIMIT.toFixed(6)),
    remaining: parseFloat(remaining.toFixed(6)),
  };
}

module.exports = { checkQuota, recordCost, EFFECTIVE_LIMIT, WINDOW_HOURS };
