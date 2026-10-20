#!/usr/bin/env node
// 记忆体 CLI —— 给 agent 用的动作
//
//   node tools/memory.mjs archive [--format dsh|codex|workbuddy|all] [--root DIR]
//   node tools/memory.mjs search <关键词> [--days N] [--limit N] [--root DIR]
//   node tools/memory.mjs days [--root DIR]
//   node tools/memory.mjs me                       # 读「关于我」
//   node tools/memory.mjs me add <一句话> [--section 基本]
//   node tools/memory.mjs me forget <关键词>       # 删掉含这个词的行
//   node tools/memory.mjs me confirm               # 把「最后确认」改成今天
//
// 输出是纯文本，给模型读。失败非 0 退出。
// 「关于我」每次写入前都会备份成 关于我.md.bak，写的时候先写 .tmp 再改名。
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BACKUP = path.join(REPO, 'backup-chat.ps1');
const expand = (p) => (p && p.startsWith('~') ? path.join(os.homedir(), p.slice(1)) : p);

const argv = process.argv.slice(2);

// 一次把参数拆干净：位置参数和 --flag 分开，
// 不然 `me add "一句话" --root X` 会把 --root 吞进正文里
function parseArgs(list) {
  const pos = [];
  const flags = {};
  for (let i = 0; i < list.length; i++) {
    const a = list[i];
    if (a.startsWith('--')) {
      const name = a.slice(2);
      const val = list[i + 1];
      if (val === undefined || val.startsWith('--')) flags[name] = true;
      else {
        flags[name] = val;
        i++;
      }
    } else pos.push(a);
  }
  return { pos, flags };
}

const { pos, flags } = parseArgs(argv);
const cmd = pos[0];
const flag = (name, fallback) => (flags[name] !== undefined && flags[name] !== true ? flags[name] : fallback);
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
          const ctx = lines.slice(Math.max(0, i - 1), Math.min(lines.length, i + 3)).join('\n');
          hits.push({ day, who, ctx });
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

// ── 关于我 ──────────────────────────────────────────────────
const mePath = () => path.join(root, '关于我.md');

const TEMPLATE = `# 关于我

> 每个新对话先读这份。只放稳定的事，流水账不写这里。
> 可以改：加一条、删一条。改完要跟人说一声。

## 基本
- 待填：住哪、在做什么、作息

## 偏好
- 待填：喜欢什么、讨厌什么、喜欢被怎么说话

## 别踩的
- 待填：什么事会让对方烦

---
最后确认：0000-00-00
`;

const today = () => {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};

function readMe() {
  const f = mePath();
  return fs.existsSync(f) ? fs.readFileSync(f, 'utf8') : null;
}

function writeMe(text) {
  const f = mePath();
  fs.mkdirSync(root, { recursive: true });
  if (fs.existsSync(f)) fs.copyFileSync(f, f + '.bak');
  const tmp = f + '.tmp';
  fs.writeFileSync(tmp, text, 'utf8');
  fs.renameSync(tmp, f);
}

function bumpConfirm(text) {
  const stamp = today();
  if (/最后确认：\d{4}-\d{2}-\d{2}/.test(text)) return text.replace(/最后确认：\d{4}-\d{2}-\d{2}/, `最后确认：${stamp}`);
  return text.trimEnd() + `\n\n---\n最后确认：${stamp}\n`;
}

function meAdd(text, section) {
  if (!text) die('用法: me add <一句话> [--section 基本]', 2);
  let t = readMe();
  if (t === null) t = TEMPLATE;

  const bullet = `- ${text}`;
  const head = new RegExp(`(^|\\n)## ${section}\\n`);
  const m = head.exec(t);
  if (m) {
    const start = m.index + m[0].length;
    const rest = t.slice(start);
    const endRel = rest.search(/\n## |\n---/);
    const end = endRel < 0 ? t.length : start + endRel + 1;
    const body = t.slice(start, end).replace(/\s+$/, '');
    t = t.slice(0, start) + body + '\n' + bullet + '\n\n' + t.slice(end).replace(/^\n+/, '');
  } else {
    const block = `## ${section}\n${bullet}\n`;
    const foot = t.indexOf('\n---');
    t = foot >= 0 ? t.slice(0, foot) + '\n' + block + '\n' + t.slice(foot) : t.trimEnd() + '\n\n' + block;
  }
  writeMe(bumpConfirm(t));
}

function meForget(keyword) {
  if (!keyword) die('用法: me forget <关键词>', 2);
  const t = readMe();
  if (t === null) die('还没有 关于我.md');
  const kept = t.split('\n').filter((l) => !(l.trim().startsWith('-') && l.includes(keyword)));
  const removed = t.split('\n').length - kept.length;
  if (removed === 0) {
    console.log(`没有含「${keyword}」的条目，没改。`);
    return 0;
  }
  writeMe(bumpConfirm(kept.join('\n')));
  return removed;
}

function meCmd() {
  const action = pos[1];
  const rest = pos.slice(2);

  if (!action) {
    const t = readMe();
    if (t === null) {
      console.log(`还没有「关于我」。\n跑一次 me add 就会建：node tools/memory.mjs me add "家在惠州"`);
      console.log(`位置将是：${mePath()}`);
      return;
    }
    const st = fs.statSync(mePath());
    console.log(`# ${mePath()}`);
    console.log(`（${(st.size / 1024).toFixed(1)} KB，最后改于 ${st.mtime.toLocaleString('zh-CN')}）\n`);
    console.log(t.trimEnd());
    return;
  }

  if (action === 'add') {
    meAdd(rest.join(' ').trim(), flag('section', '基本'));
  } else if (action === 'forget') {
    const n = meForget(rest.join(' ').trim());
    if (typeof n === 'number') console.log(`删掉 ${n} 行。`);
  } else if (action === 'confirm') {
    const t = readMe();
    if (t === null) die('还没有 关于我.md');
    writeMe(bumpConfirm(t));
    console.log(`最后确认已改成 ${today()}。`);
  } else {
    die('用法: me [add <一句话> | forget <关键词> | confirm]', 2);
  }

  const after = readMe();
  if (after !== null) {
    console.log('--- 现在的 关于我 ---');
    console.log(after.trimEnd());
  }
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
  search(pos[1], { days: Number(flag('days', '0')), limit: Number(flag('limit', '20')) });
} else if (cmd === 'days') {
  days_();
} else if (cmd === 'me') {
  meCmd();
} else {
  console.error(`记忆体 CLI

  node tools/memory.mjs archive [--format dsh|codex|workbuddy|all] [--root DIR]
  node tools/memory.mjs search <关键词> [--days N] [--limit N] [--root DIR]
  node tools/memory.mjs days [--root DIR]
  node tools/memory.mjs me
  node tools/memory.mjs me add <一句话> [--section 基本]
  node tools/memory.mjs me forget <关键词>
  node tools/memory.mjs me confirm
`);
  process.exit(2);
}
