#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const GITHUB_API = 'https://api.github.com';

const ACTIVE_CLIENTS = [
  { name: 'Clash Verge Rev', repo: 'clash-verge-rev/clash-verge-rev' },
  { name: 'FlClash', repo: 'chen08209/FlClash' },
  { name: 'Clash Meta for Android', repo: 'MetaCubeX/ClashMetaForAndroid' },
  { name: 'Clash Mi', repo: 'KaringX/clashmi' },
  { name: 'v2rayN', repo: '2dust/v2rayN' },
  { name: 'v2rayNG', repo: '2dust/v2rayNG' },
  { name: 'GUI.for.Clash', repo: 'GUI-for-Cores/GUI.for.Clash' },
  { name: 'Clash Party', repo: 'mihomo-party-org/mihomo-party' },
  { name: 'Pandora-Box', repo: 'snakem982/Pandora-Box' },
  { name: 'Nyanpasu', repo: 'libnyanpasu/clash-nyanpasu' },
];

const CLIENT_TO_REPO = new Map(ACTIVE_CLIENTS.map(client => [client.name, client.repo]));
const UNIQUE_REPOS = [...new Set(ACTIVE_CLIENTS.map(client => client.repo))];
const README_PATH = path.resolve(__dirname, '..', 'README.md');

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

function headers() {
  const h = { Accept: 'application/vnd.github+json' };
  const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
  if (token) h.Authorization = `Bearer ${token}`;
  return h;
}

function assertOk(res, url) {
  if (!res.ok) throw new Error(`GitHub request failed: ${res.status} ${res.statusText} (${url})`);
}

function toAsiaShanghai(isoString) {
  const d = new Date(isoString);
  if (Number.isNaN(d.getTime())) return null;
  return new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(d);
}

function versionBadge(repo, version, color = 'blue') {
  return `![Ver](https://img.shields.io/endpoint?url=https://githubdate.bcdyf49t45.workers.dev/${repo}?type=version&v=1?label=&color=${color})`;
}

function dateBadge(repo) {
  return `![Date](https://img.shields.io/endpoint?url=https://githubdate.bcdyf49t45.workers.dev/${repo}&label=)`;
}

async function fetchWithRetry(url, retries = 3) {
  let lastErr;
  for (let i = 0; i < retries; i++) {
    try {
      const res = await fetch(url, { headers: headers() });
      if (res.status === 403 || res.status === 429) {
        const reset = Number(res.headers.get('x-ratelimit-reset'));
        const waitMs = Number.isFinite(reset) ? Math.max(2000, (reset * 1000) - Date.now() + 1500) : 2000 * (i + 1);
        await sleep(waitMs);
        continue;
      }
      assertOk(res, url);
      return await res.json();
    } catch (err) {
      lastErr = err;
      await sleep(1500 * (i + 1));
    }
  }
  throw lastErr;
}

function pickLatestRelease(releases) {
  return (releases || []).find(r => !r.draft && !r.prerelease) || (releases || [])[0] || null;
}

function normalizeTag(tag) {
  if (!tag) return '';
  return tag.replace(/^v/i, '');
}

async function loadLatestReleases() {
  const results = new Map();
  for (const repo of UNIQUE_REPOS) {
    const releases = await fetchWithRetry(`${GITHUB_API}/repos/${repo}/releases?per_page=5`);
    const best = pickLatestRelease(releases);
    if (best) {
      results.set(repo, {
        version: normalizeTag(best.tag_name),
        date: toAsiaShanghai(best.published_at || best.created_at),
      });
    }
    await sleep(250);
  }
  return results;
}

function updateReadme(readme, latestMap) {
  const marker = '<!-- AUTO:CLIENT_VERSIONS -->';
  const markerIdx = readme.indexOf(marker);
  if (markerIdx === -1) throw new Error('README.md missing table section marker: ' + marker);

  const lines = readme.split('\n');
  const headerIdx = lines.findIndex((line, idx) => idx > lines.indexOf(marker) && line.startsWith('| 客户端'));
  if (headerIdx === -1) throw new Error('README.md missing client table header.');

  const sepIdx = lines.findIndex((line, idx) => idx > headerIdx && /^\|?\s*:---/.test(line));
  if (sepIdx === -1) throw new Error('README.md missing table separator.');

  const bodyStartIdx = sepIdx + 1;
  const outLines = [];
  let changed = false;

  for (let idx = bodyStartIdx; idx < lines.length && lines[idx].startsWith('|'); idx++) {
    const line = lines[idx];
    const cols = line.split('|').slice(1, -1).map(s => s.trim());
    const m = cols[0]?.match(/^\*\*(.+?)\*\*$/);
    const name = m ? m[1] : '';
    const repo = name ? CLIENT_TO_REPO.get(name) : null;

    if (repo && latestMap.has(repo)) {
      const latest = latestMap.get(repo);
      const newCols = [...cols];
      newCols[1] = versionBadge(repo, latest.version);
      newCols[2] = dateBadge(repo);
      const newLine = `| ${newCols.join(' | ')} |`;
      if (newLine !== line) changed = true;
      outLines.push(newLine);
    } else {
      outLines.push(line);
    }
  }

  const newReadme = [...lines.slice(0, bodyStartIdx), ...outLines].join('\n') + '\n';
  return { newReadme, changed };
}

async function main() {
  const latest = await loadLatestReleases();
  const readme = fs.readFileSync(README_PATH, 'utf-8');
  const { newReadme, changed } = updateReadme(readme, latest);
  fs.writeFileSync(README_PATH, newReadme, 'utf-8');
  console.log(changed ? 'changed' : 'unchanged');
}

main().catch(err => {
  console.error(err.message || err);
  process.exit(1);
});
