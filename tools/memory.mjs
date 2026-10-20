#!/usr/bin/env node
// 记忆体 CLI —— 给 agent 用的两个动作：归档、搜记忆
//
//   node tools/memory.mjs archive [--format dsh|codex|workbuddy|all] [--root DIR]
//   node tools/memory.mjs search <关键词> [--days N] [--limit N] [--root DIR]
//   node tools/memory.mjs days [--root DIR]
//
// 输出是纯文本，给模型读，不给人点。失败非 0 退出。
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BACKUP = path.join(REPO, 'backup-chat.ps1');
const expand = (p) => (p && p.startsWith('~') ? path.join(os.homedir(), p.slice(1)) : p);

const argv = process.argv.slice(2);
const cmd = argv[0];
const flag = (name, fallback) => {
  const i = argv.indexOf('--' + name);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : fallback;
};
const root = expand(flag('root', process.env.CHAT_ARCHIVE_ROOT ?? '~/dsh-memory'));

const die = (msg, code = 1) => {
  console.error(msg);
  process.exit(code);
};

function dayDirs() {
  if (!fs.existsSync(root)) return [];
  return fs
    .readdirSync(root, { withFileTypes: true })
    .filter((d) => d.isDirectory() && /^\d{4}-\d{2}-\d{2}$/.test(d.name))
    .map((d) => d.name)
    .sort();
}

// ── 归档 ────────────────────────────────────────────────────
function archive(format) {
  const formats = format === 'all' ? ['dsh', 'codex', 'workbuddy'] : [format];
  return new Promise((resolve) => {
    const results = [];
    const next = (i) => {
      if (i >= formats.length) return resolve(results);
      const f = formats[i];
      const args = [
        '-NoProfile', '-ExecutionPolicy', 'Bypass',
        '-File', BACKUP,
        '-Format', f,
        '-Root', root,
        '-AssistantName', flag('assistant', '助理'),
        '-UserName', flag('user', '你'),
      ];
      const opts = { cwd: REPO, timeout: 180000, windowsHide: true, maxBuffer: 4 << 20 };
      const exes = [process.env.PWSH, 'pwsh', 'powershell'].filter(Boolean);
      const attempt = (k) => {
        if (k >= exes.length) {
          results.push({ format: f, code: -1, out: '找不到 PowerShell' });
          return next(i + 1);
        }
        execFile(exes[k], args, opts, (err, stdout, stderr) => {
          if (err && (err.code === 'ENOENT' || err.code === 'EACCES')) return attempt(k + 1);
          results.push({
            format: f,
            code: typeof err?.code === 'number' ? err.code : err ? -1 : 0,
            out: `${stdout ?? ''}${stderr ?? ''}`.trim(),
          });
          next(i + 1);
        });
      };
      attempt(0);
    };
    next(0);
  });
}

// ── 搜记忆 ──────────────────────────────────────────────────
function search(keyword, { days, limit }) {
  if (!keyword) die('用法: search <关键词>', 2);
  if (!fs.existsSync(root)) die(`存档目录不存在：${root}\n先跑一次 archive。`);

  const list = dayDirs();
  if (!list.length) die(`存档目录里还没有任何一天：${root}`);
  const take = days ? list.slice(-days) : list;

  const kw = keyword.toLowerCase();
  const hits = [];
  for (const day of take) {
    const dir = path.join(root, day, '聊天');
    if (!fs.existsSync(dir)) continue;
    for (const f of fs.readdirSync(dir).filter((n) => n.endsWith('.txt'))) {
      const text = fs.readFileSync(path.join(dir, f), 'utf8');
      const lines = text.split('\n');
      let who = '';
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (/^\[[^\]]+\] /.test(line)) who = line.trim();
        if (line.toLowerCase().includes(kw)) {
          // 带一点上下文，别只给一行
          const ctx = lines.slice(Math.max(0, i - 1), Math.min(lines.length, i + 3)).join('\n');
          hits.push({ day, who, line: line.trim(), ctx });
          if (hits.length >= limit) break;
        }
      }
      if (hits.length >= limit) break;
    }
    if (hits.length >= limit) break;
  }

  if (!hits.length) {
    console.log(`没有找到「${keyword}」。查过 ${take.length} 天：${take.join(', ')}`);
    return;
  }
  console.log(`找到 ${hits.length} 处（查了 ${take.length} 天）\n`);
  for (const h of hits) {
    console.log(`── ${h.day}  ${h.who}`);
    console.log(h.ctx.trimEnd());
    console.log('');
  }
}

// ── 有哪些天 ────────────────────────────────────────────────
function days_() {
  const list = dayDirs();
  if (!list.length) return die(`存档目录里还没有任何一天：${root}`);
  for (const d of list) {
    const chat = path.join(root, d, '聊天');
    let msgs = 0;
    let bytes = 0;
    if (fs.existsSync(chat)) {
      for (const f of fs.readdirSync(chat).filter((n) => n.endsWith('.txt'))) {
        const p = path.join(chat, f);
        const text = fs.readFileSync(p, 'utf8');
        msgs += (text.match(/^\[[^\]]+\] /gm) ?? []).length;
        bytes += fs.statSync(p).size;
      }
    }
    console.log(`${d}  ${msgs} 条消息  ${(bytes / 1024).toFixed(0)} KB`);
  }
  console.log(`\n共 ${list.length} 天。目录：${root}`);
}

// ── 入口 ────────────────────────────────────────────────────
if (cmd === 'archive') {
  const format = flag('format', 'dsh');
  const results = await archive(format);
  let bad = 0;
  for (const r of results) {
    console.log(`[${r.format}] exit ${r.code}`);
    if (r.out) console.log(r.out.split('\n').map((l) => '  ' + l).join('\n'));
    if (r.code !== 0) bad++;
  }
  console.log(`\n输出目录：${root}`);
  process.exit(bad ? 1 : 0);
} else if (cmd === 'search') {
  search(argv[1], {
    days: Number(flag('days', '0')),
    limit: Number(flag('limit', '20')),
  });
} else if (cmd === 'days') {
  days_();
} else {
  console.error(`记忆体 CLI

  node tools/memory.mjs archive [--format dsh|codex|workbuddy|all] [--root DIR]
  node tools/memory.mjs search <关键词> [--days N] [--limit N] [--root DIR]
  node tools/memory.mjs days [--root DIR]
`);
  process.exit(2);
}
