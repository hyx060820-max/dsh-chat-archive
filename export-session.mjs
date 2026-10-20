// export-session.mjs —— 把 DSH 会话（多帧 zstd 的 JSONL）导出成可读文件
//
// 用法:
//   node export-session.mjs <输入.zstd> <输出> [选项]
//
// 失败时以非 0 退出并打印原因，绝不静默产出空文件。
// 依赖 Node.js 22.15 / 23.8 以上（要 zlib.zstdDecompressSync）。
import zlib from 'node:zlib';
import fs from 'node:fs';
import path from 'node:path';

const USAGE = `用法: node export-session.mjs <输入.zstd> <输出> [选项]

选项:
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
if (opts.day && !/^\d{4}-\d{2}-\d{2}$/.test(opts.day)) {
  console.error(`--day 格式应为 YYYY-MM-DD，收到: ${opts.day}`);
  process.exit(2);
}
if (!fs.existsSync(src)) { console.error(`输入不存在: ${src}`); process.exit(3); }

// ---- 读出所有帧：DSH 的会话文件是多帧追加写的 ----
const buf = fs.readFileSync(src);
const starts = [];
for (let i = 0; i + 4 <= buf.length; i++) {
  if (buf[i] === 0x28 && buf[i + 1] === 0xb5 && buf[i + 2] === 0x2f && buf[i + 3] === 0xfd) starts.push(i);
}
if (starts.length === 0) { console.error('不是有效的 zstd 会话文件（找不到帧头）'); process.exit(4); }
starts.push(buf.length);

const parts = [];
let badFrames = 0;
for (let i = 0; i < starts.length - 1; i++) {
  try { parts.push(zlib.zstdDecompressSync(buf.subarray(starts[i], starts[i + 1])).toString('utf8')); }
  catch { badFrames++; }
}
if (badFrames > 0) console.error(`警告: ${badFrames} 个帧解压失败，已跳过`);

const events = [];
for (const l of parts.join('').split('\n').filter(Boolean)) {
  try { events.push(JSON.parse(l)); } catch { /* 坏行跳过 */ }
}
if (events.length === 0) { console.error('解压成功但没有任何事件'); process.exit(5); }

const pad = (n) => String(n).padStart(2, '0');
const dayKey = (ms) => { const d = new Date(ms); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
const hhmm = (ms) => { const d = new Date(ms); return `${pad(d.getHours())}:${pad(d.getMinutes())}`; };
const full = (ms) => { const d = new Date(ms); return `${dayKey(ms)} ${hhmm(ms)}`; };
const texts = (content) => (content ?? []).filter((c) => c?.type === 'text' && typeof c.text === 'string').map((c) => c.text).join('\n').trim();
const clip = (s, n) => { s = String(s ?? '').replace(/\s+/g, ' ').trim(); return s.length > n ? s.slice(0, n) + '…' : s; };
const stripCode = (s) => s.replace(/```[\s\S]*?```/g, '\n〔代码略〕\n').replace(/\n{3,}/g, '\n\n').trim();
// 图片在会话里存的是 attachmentId（sha256:<hash>），不是路径
const imagesOf = (content) => (content ?? []).filter((c) => c?.type === 'image' && c.attachment?.attachmentId).map((c) => c.attachment);
const shortHash = (id) => String(id).replace(/^sha256:/, '').slice(0, 12);

const meta = events.find((e) => e.type === 'session') ?? {};
const title = (events.find((e) => e.type === 'session/title')?.data?.title) ?? meta.id ?? '未命名会话';

// ---- 收集消息 ----
const items = [];
let lastText = '';
for (const e of events) {
  const t = e.type, d = e.data ?? {};
  if (t === 'user/message') {
    if ((d.source?.kind ?? 'user') !== 'user') continue;
    let body = texts(d.content);
    if (!body) continue;
    if (opts.plain || opts.txt) body = stripCode(body);
    if (!body || body === lastText) continue;
    items.push({ who: opts.userName, time: e.time, body, images: imagesOf(d.content) });
    lastText = body;
  } else if (t === 'assistant/message') {
    let body = texts(d.message?.content);
    if (!body) continue;
    if (opts.plain || opts.txt) body = stripCode(body);
    if (!body || body === lastText) continue;
    items.push({ who: opts.assistantName, time: e.time, body, images: imagesOf(d.message?.content) });
    lastText = body;
  } else if (t === 'tool/call') {
    if (!opts.plain && !opts.txt) items.push({ who: '', time: e.time, body: `⚙ ${d.name} ${clip(d.arguments, 160)}`, tool: true });
  }
}

const kept = opts.day ? items.filter((i) => dayKey(i.time) === opts.day) : items;

// ---- 附件图片：attachmentId 是 sha256:<hash>，文件在 <附件库>/<hash 前两位>/<hash> ----
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
  out.push(`会话：${title}`);
  const t0 = kept[0].time, t1 = kept.at(-1).time;
  out.push(`时间：${full(t0)} ~ ${opts.day ? hhmm(t1) : full(t1)}　（${kept.length} 条消息）`);
  if (attCopied || attMissing) out.push(`图片：${attCopied} 张已存${attMissing ? `，${attMissing} 张找不到` : ''}`);
  out.push('='.repeat(64));
  out.push('');
  for (const i of kept) {
    out.push(`[${stamp(i.time)}] ${i.who}`);
    out.push(i.body);
    if (i.images?.length) out.push(`〔图：${i.images.map((a) => `${a.name ?? 'image'} · ${shortHash(a.attachmentId)}`).join('，')}〕`);
    out.push('');
  }
} else {
  out.push(`# ${title}`);
  out.push('');
  out.push(`- 会话 ID：\`${meta.id ?? '?'}\``);
  out.push(`- 工作目录：\`${meta.cwd ?? '?'}\``);
  out.push('');
  out.push('---');
  out.push('');
  for (const i of kept) {
    out.push(i.tool ? `> ${i.body}` : `## ${i.who} · ${full(i.time)}`);
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
console.log(`  ✓ ${kept.length} 条消息${attCopied ? `，图片 ${attCopied} 张` : ''}`);
