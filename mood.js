// mood.js — message selector; returns naughty or normal messages based on MOOD env var
const fs   = require('fs');
const path = require('path');

const IS_NAUGHTY = (process.env.MOOD ?? '').toUpperCase() === 'NAUGHTY';

let _naughty = null;
function getNaughtyData() {
  if (_naughty === null) {
    _naughty = JSON.parse(fs.readFileSync(path.join(__dirname, 'moods', 'naughty.json'), 'utf8'));
  }
  return _naughty;
}

const NORMAL = {
  startup:         'Here comes Klausi-Mausi!!!',
  busy:            '⏳ Already working on a task. Please wait until it finishes.',
  success:         '✅ **Done!**\n${content}',
  error:           '❌ **Failed**\n${content}',
  unauthorized:    '⛔ You are not authorised to use this bot.',
  empty_task:      'Please describe a task after `${prefix}`. Try `${prefix}help`.',
  help:            null,
  status:          '📊 **Repo Status**\n${content}',
  quota_status:    '💰 Budget used: **$${used}** / $${limit} — **$${remaining}** remaining.',
  quota_warning:   '⚠️ Budget low! Used **$${used}** / $${limit} — only **$${remaining}** remaining in this window.',
  quota_exhausted: '🚫 Quota exhausted (**$${used}** of $${limit} used). Resets in **${minutes}** minutes.',
  working:         '🤔 Working on it... (${elapsed}m elapsed)',
  plan_start:      '🗺️ Planning mode — describing what I would do without making any changes...',
  plan_complete:   '📋 **Plan:**\n${content}',
  rate_limited:    '🚫 Claude Code hit its usage limit. Please wait for the session to reset.',
};

/**
 * Get a response string for the given category.
 * @param {string} category
 * @param {Object} [vars={}]  — values for ${key} placeholder substitution
 * @returns {string}
 */
function getResponse(category, vars = {}) {
  let template;
  if (IS_NAUGHTY) {
    const data = getNaughtyData();
    const arr  = data[category];
    if (arr && arr.length > 0) {
      template = arr[Math.floor(Math.random() * arr.length)];
    } else {
      template = NORMAL[category] ?? `[unknown category: ${category}]`;
    }
  } else {
    template = NORMAL[category] ?? `[unknown category: ${category}]`;
  }

  if (!template) return template;

  return template.replace(/\$\{(\w+)\}/g, (_, key) =>
    vars[key] !== undefined ? String(vars[key]) : `\${${key}}`
  );
}

module.exports = { getResponse, IS_NAUGHTY };
