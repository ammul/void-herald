// claude.js — runs Claude Code CLI non-interactively in the repo
const { spawn } = require('child_process');
const path = require('path');

const REPO_PATH  = process.env.REPO_PATH;
const CLAUDE_BIN = process.env.CLAUDE_BIN ?? 'claude';

const ANSI_RE = /\x1B\[[0-9;]*[mGKHFJA-Z]/g;

// Sensitive vars are stripped so the Claude subprocess cannot exfiltrate them
const { DISCORD_TOKEN, GITHUB_WEBHOOK_SECRET, ...SAFE_ENV } = process.env;

// Ensure REPO_PATH is absolute so Claude can't 'guess' where it is
const ABSOLUTE_REPO_PATH = path.resolve(process.env.REPO_PATH || './workspace');

function runClaudeCode(task, repoStatus = '') {

  // Check if REPO_PATH is actually set
  if (!ABSOLUTE_REPO_PATH) {
     return Promise.reject(new Error("REPO_PATH environment variable is not set."));
  }

  const constraint = `You are a git assistant. Only read, write, or edit files inside ${REPO_PATH}. Refuse any task that would operate outside this directory.\n\n`;
  const context    = repoStatus ? `Current repo state:\n${repoStatus}\n\nTask: ${task}` : task;
  const prompt     = constraint + context;

  return new Promise((resolve, reject) => {
    const proc = spawn(CLAUDE_BIN, [
      '--print',
      '-p', prompt,
      // TWEAK: Restrict Bash commands even further if possible
      '--allowedTools', 'Bash(git *) Bash(ls *) Read Edit Write',
    ], {
      cwd: ABSOLUTE_REPO_PATH, // Use the resolved absolute path
      stdio: ['pipe', 'pipe', 'pipe'],
      env: SAFE_ENV,
    });

    proc.stdin.end();

    let stdout = '';
    let stderr = '';
    proc.stdout.on('data', chunk => { stdout += chunk; });
    proc.stderr.on('data', chunk => { stderr += chunk; });

    proc.on('close', (code) => {
      const raw = code === 0 ? stdout : (stderr || stdout);
      resolve({
        success: code === 0,
        output: raw.replace(ANSI_RE, '').trim(),
      });
    });

    proc.on('error', (err) => {
      reject(err);
    });
  });
}

module.exports = { runClaudeCode };
