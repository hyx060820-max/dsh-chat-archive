// export-session.mjs —— 把 AI agent 的会话导出成可读文件
//
// 用法:
//   node export-session.mjs <输入> <输出> [选项]
//
// 格式靠猜，也可以用 --format 指定。
// 失败时以非 0 退出并打印原因，绝不静默产出空文件。
// 依赖 Node.js 22.15 / 23.8 以上（DSH 格式要 zlib.zstdDecompressSync）。
import fs from 'node:fs';
import path from 'node:path';
import { adapters, resolve, names } from './sources/index.mjs';

const USAGE = `用法: node export-session.mjs <输入> <输出> [选项]

选项:
  --format <名字>            会话格式，默认 auto（靠文件头猜）
                             可选: auto, ${names().join(', ')}
  --txt                      纯文本格式（默认 markdown）
  --plain                    去掉工具调用，代码块换成〔代码略〕
  --day YYYY-MM-DD           只导出这一天的消息
  --append                   追加到输出文件，不覆盖
  --attachments-dir <目录>    把消息里引用到的图片复制到该目录
  --attachments-root <目录>   附件库根目录（默认 ~/.dsh/attachments/v1/objects）
  --assistant-name <名字>     助手的显示名（默认「助理」）
  --user-name <名字>          用户的显示名（默认「你」）
  -h, --help                 显示本帮助
`;

const argv = process.argv.slice(2);
const opts = {
  format: 'auto',
  plain: false,
  txt: false,
  append: false,
  day: null,
  attDir: null,
  attRoot: null,
  assistantName: '助理',
  userName: '你',
};
const positional = [];

for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  const next = () => {
    const v = argv[++i];
    if (v === undefined) { console.error(`选项 ${a} 缺少值`); process.exit(2); }
    return v;
  };
  if (a === '-h' || a === '--help') { process.stdout.write(USAGE); process.exit(0); }
  else if (a === '--plain') opts.plain = true;
  else if (a === '--txt') opts.txt = true;
  else if (a === '--append') opts.append = true;
  else if (a === '--format') opts.format = next();
  else if (a === '--day') opts.day = next();
  else if (a === '--attachments-dir') opts.attDir = next();
  else if (a === '--attachments-root') opts.attRoot = next();
  else if (a === '--assistant-name') opts.assistantName = next();
  else if (a === '--user-name') opts.userName = next();
  else if (a.startsWith('--')) { console.error(`未知选项: ${a}\n\n${USAGE}`); process.exit(2); }
  else positional.push(a);
}

const [src, dst] = positional;
if (!src || !dst) {
  console.error(USAGE);
  process.exit(2);
}
if (opts.day) {
  // 光看格式不够：2026-13-99 也长得像日期
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(opts.day);
  const d = m ? new Date(Date.UTC(+m[1], +m[2] - 1, +m[3])) : null;
  const ok =
    d &&
    !Number.isNaN(d.getTime()) &&
    d.getUTCFullYear() === +m[1] &&
    d.getUTCMonth() + 1 === +m[2] &&
    d.getUTCDate() === +m[3];
  if (!ok) {
    console.error(`--day 不是有效日期：${opts.day}（要 YYYY-MM-DD，例如 2026-10-20）`);
    process.exit(2);
  }
}
if (!fs.existsSync(src)) { console.error(`输入不存在: ${src}`); process.exit(3); }

// ---- 选格式 ----
let adapter;
try {
  ({ adapter } = resolve(src, opts.format));
} catch (e) {
  console.error(e.message);
  process.exit(4);
}

// ---- 读 ----
let parsed;
try {
  parsed = adapter.read(src);
} catch (e) {
  console.error(`读取失败（${adapter.name}）：${e.message}`);
  process.exit(5);
}
for (const w of parsed.warnings ?? []) console.error(`警告: ${w}`);

const { meta, items: allItems } = parsed;

const pad = (n) => String(n).padStart(2, '0');
const isTime = (ms) => typeof ms === 'number' && Number.isFinite(ms);
const dayKey = (ms) => {
  if (!isTime(ms)) return '?';
  const d = new Date(ms);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};
const hhmm = (ms) => {
  if (!isTime(ms)) return '--:--';
  const d = new Date(ms);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
};
// 时间缺失时不要吐 NaN-NaN-NaN，说得清楚一点
const full = (ms) => (isTime(ms) ? `${dayKey(ms)} ${hhmm(ms)}` : '时间未知');
const stripCode = (s) => s.replace(/```[\s\S]*?```/g, '\n〔代码略〕\n').replace(/\n{3,}/g, '\n\n').trim();
const shortHash = (id) => String(id).replace(/^sha256:/, '').slice(0, 12);
const whoOf = (role) => (role === 'user' ? opts.userName : role === 'assistant' ? opts.assistantName : '');

// ---- 过滤 ----
// 纯文本和 --plain 都不收工具调用
let items = allItems;
if (opts.plain || opts.txt) items = items.filter((i) => !i.tool);

const kept = opts.day ? items.filter((i) => dayKey(i.time) === opts.day) : items;

// ---- 附件图片 ----
// DSH 存 attachmentId（sha256:<hash>），文件在 <附件库>/<hash 前两位>/<hash>
let attCopied = 0, attMissing = 0;
if (opts.attDir) {
  fs.mkdirSync(opts.attDir, { recursive: true });
  const rootDir = opts.attRoot
    ?? path.join(process.env.USERPROFILE ?? process.env.HOME ?? '.', '.dsh', 'attachments', 'v1', 'objects');
  const extOf = (mediaType) => {
    const m = String(mediaType ?? '').toLowerCase();
    if (m.includes('png')) return 'png';
    if (m.includes('jpeg') || m.includes('jpg')) return 'jpg';
    if (m.includes('gif')) return 'gif';
    if (m.includes('webp')) return 'webp';
    return 'bin';
  };
  const done = new Set();
  for (const it of kept) {
    for (const a of it.images ?? []) {
      const hash = String(a.attachmentId).replace(/^sha256:/, '');
      if (done.has(hash)) continue;
      done.add(hash);
      const srcPath = path.join(rootDir, hash.slice(0, 2), hash);
      if (!fs.existsSync(srcPath)) { attMissing++; continue; }
      try {
        const outPath = path.join(opts.attDir, `${hash}.${extOf(a.mediaType)}`);
        if (!fs.existsSync(outPath)) { fs.copyFileSync(srcPath, outPath); attCopied++; }
      } catch { attMissing++; }
    }
  }
}

// ---- 写正文 ----
if (opts.day && kept.length === 0) {
  console.log('  · 这一天没有消息，跳过');
  process.exit(0);
}

const out = [];
if (opts.txt) {
  const stamp = (ms) => (opts.day ? hhmm(ms) : full(ms));
  out.push('='.repeat(64));
  out.push(`会话：${meta.title ?? '未命名会话'}`);
  const t0 = kept[0].time, t1 = kept.at(-1).time;
  out.push(`时间：${full(t0)} ~ ${opts.day ? hhmm(t1) : full(t1)}　（${kept.length} 条消息）`);
  if (attCopied || attMissing) out.push(`图片：${attCopied} 张已存${attMissing ? `，${attMissing} 张找不到` : ''}`);
  out.push('='.repeat(64));
  out.push('');
  for (const i of kept) {
    out.push(`[${stamp(i.time)}] ${whoOf(i.role)}`);
    out.push(i.body);
    if (i.images?.length) out.push(`〔图：${i.images.map((a) => `${a.name ?? 'image'} · ${shortHash(a.attachmentId)}`).join('，')}〕`);
    out.push('');
  }
} else {
  out.push(`# ${meta.title ?? '未命名会话'}`);
  out.push('');
  out.push(`- 格式：\`${adapter.name}\``);
  if (meta.id) out.push(`- 会话 ID：\`${meta.id}\``);
  if (meta.cwd) out.push(`- 工作目录：\`${meta.cwd}\``);
  out.push('');
  out.push('---');
  out.push('');
  for (const i of kept) {
    out.push(i.tool ? `> ${i.body}` : `## ${whoOf(i.role)} · ${full(i.time)}`);
    out.push('');
    if (!i.tool) out.push(i.body);
    out.push('');
  }
  out.push('---');
  out.push('');
  out.push(`_导出时间：${full(Date.now())}_`);
}

const text = out.join('\n') + '\n';
if (opts.append) fs.appendFileSync(dst, text, 'utf8');
else fs.writeFileSync(dst, text, 'utf8');
console.log(`  ✓ ${kept.length} 条消息${attCopied ? `，图片 ${attCopied} 张` : ''}（${adapter.name}）`);
