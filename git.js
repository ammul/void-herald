// git.js — repo status helper
const { execSync } = require('child_process');
const fs = require('fs');

const REPO_PATH = process.env.REPO_PATH;

function getRepoStatus() {
  if (!fs.existsSync(REPO_PATH)) return 'Repo path does not exist.';
  try {
    const branch = execSync('git branch --show-current', { cwd: REPO_PATH, encoding: 'utf8' }).trim();
    const status = execSync('git status --short',        { cwd: REPO_PATH, encoding: 'utf8' }).trim();
    const log    = execSync('git log --oneline -3',      { cwd: REPO_PATH, encoding: 'utf8' }).trim();
    return [
      `Branch: ${branch}`,
      status ? `Changes:\n${status}` : 'Working tree clean',
      `Recent commits:\n${log}`,
    ].join('\n');
  } catch (err) {
    return `Could not read repo status: ${err.message}`;
  }
}

module.exports = { getRepoStatus };
