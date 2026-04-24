// claude.js — runs Claude Code CLI non-interactively in the repo
const { spawn } = require('child_process');
const path = require('path');

const REPO_PATH  = process.env.REPO_PATH;
const CLAUDE_BIN = process.env.CLAUDE_BIN ?? 'claude';

const ANSI_RE = /\x1B\[[0-9;]*[mGKHFJA-Z]/g;

// Sensitive vars are stripped so the Claude subprocess cannot exfiltrate them
const { DISCORD_TOKEN, GITHUB_WEBHOOK_SECRET, GITHUB_TOKEN, ...SAFE_ENV } = process.env;

const ABSOLUTE_REPO_PATH = path.resolve(process.env.REPO_PATH || './workspace');

function spawnClaude(args) {
  if (!ABSOLUTE_REPO_PATH) {
    return Promise.reject(new Error('REPO_PATH environment variable is not set.'));
  }

  return new Promise((resolve, reject) => {
    const proc = spawn(CLAUDE_BIN, args, {
      cwd: ABSOLUTE_REPO_PATH,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: SAFE_ENV,
    });

    proc.stdin.end();

    let stdout = '';
    let stderr = '';
    proc.stdout.on('data', chunk => { stdout += chunk; });
    proc.stderr.on('data', chunk => { stderr += chunk; });

    proc.on('close', (exitCode) => {
      const rawStdout = stdout.replace(ANSI_RE, '').trim();
      let output, cost_usd = 0, success;

      try {
        const parsed = JSON.parse(rawStdout);
        if (parsed && parsed.type === 'result') {
          success  = !parsed.is_error && exitCode === 0;
          output   = (parsed.result ?? '').trim();
          cost_usd = parsed.total_cost_usd ?? 0;
        } else {
          success = exitCode === 0;
          output  = parsed.result ? String(parsed.result).trim() : rawStdout;
        }
      } catch {
        const raw = exitCode === 0 ? rawStdout : (stderr.replace(ANSI_RE, '').trim() || rawStdout);
        success  = exitCode === 0;
        output   = raw;
        cost_usd = 0;
      }

      resolve({ success, output, cost_usd });
    });

    proc.on('error', reject);
  });
}

function runClaudeCode(task, repoStatus = '') {
  const constraint = `You are a git assistant. Only read, write, or edit files inside ${REPO_PATH}. Refuse any task that would operate outside this directory.\n\n`;
  const context    = repoStatus ? `Current repo state:\n${repoStatus}\n\nTask: ${task}` : task;
  const prompt     = constraint + context;

  return spawnClaude([
    '--print',
    '-p', prompt,
    '--allowedTools', 'Bash(git *) Bash(ls *) Read Edit Write',
    '--output-format', 'json',
  ]);
}

function runClaudeCodePlan(task, repoStatus = '') {
  const constraint = `You are a planning assistant. Only describe changes you would make inside ${REPO_PATH}. Do not execute any tools or modify any files.\n\n`;
  const context    = repoStatus ? `Current repo state:\n${repoStatus}\n\nTask: ${task}` : task;
  const prompt     = constraint + context;

  return spawnClaude([
    '--print',
    '-p', prompt,
    '--permission-mode', 'plan',
    '--output-format', 'json',
  ]);
}

module.exports = { runClaudeCode, runClaudeCodePlan };
