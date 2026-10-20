// DSH（DeepSeek Harness）会话：多帧 zstd 包着的 JSONL
//
// 文件结构：一连串 zstd 帧头 0x28 0xB5 0x2F 0xFD 拼接而成，每帧是一段 JSONL 文本。
// 事件类型：session / session/title / user/message / assistant/message / tool/call
import zlib from 'node:zlib';
import fs from 'node:fs';

export const name = 'dsh';
export const label = 'DSH（DeepSeek Harness）';
export const patterns = ['session.v4.jsonl.zstd'];

const MAGIC = [0x28, 0xb5, 0x2f, 0xfd];

export function detect(file) {
  let fd;
  try {
    fd = fs.openSync(file, 'r');
    const b = Buffer.alloc(4);
    const n = fs.readSync(fd, b, 0, 4, 0);
    return n === 4 && MAGIC.every((m, i) => b[i] === m);
  } catch {
    return false;
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
  }
}

const texts = (content) =>
  (content ?? [])
    .filter((c) => c?.type === 'text' && typeof c.text === 'string')
    .map((c) => c.text)
    .join('\n')
    .trim();

const clip = (s, n) => {
  s = String(s ?? '').replace(/\s+/g, ' ').trim();
  return s.length > n ? s.slice(0, n) + '…' : s;
};

const imagesOf = (content) =>
  (content ?? [])
    .filter((c) => c?.type === 'image' && c.attachment?.attachmentId)
    .map((c) => c.attachment);

export function read(file) {
  const buf = fs.readFileSync(file);

  // 逐字节找帧头，按位置切帧
  const starts = [];
  for (let i = 0; i + 4 <= buf.length; i++) {
    if (buf[i] === 0x28 && buf[i + 1] === 0xb5 && buf[i + 2] === 0x2f && buf[i + 3] === 0xfd) starts.push(i);
  }
  if (starts.length === 0) throw new Error('不是有效的 zstd 会话文件（找不到帧头）');
  starts.push(buf.length);

  const parts = [];
  const warnings = [];
  let badFrames = 0;
  for (let i = 0; i < starts.length - 1; i++) {
    try {
      parts.push(zlib.zstdDecompressSync(buf.subarray(starts[i], starts[i + 1])).toString('utf8'));
    } catch {
      badFrames++;
    }
  }
  if (badFrames > 0) warnings.push(`${badFrames} 个帧解压失败，已跳过`);

  const events = [];
  for (const l of parts.join('').split('\n').filter(Boolean)) {
    try {
      events.push(JSON.parse(l));
    } catch {
      /* 坏行跳过 */
    }
  }
  if (events.length === 0) throw new Error('解压成功但没有任何事件');

  const meta = events.find((e) => e.type === 'session') ?? {};
  const title =
    events.find((e) => e.type === 'session/title')?.data?.title ?? meta.id ?? '未命名会话';

  const items = [];
  let lastText = '';
  for (const e of events) {
    const t = e.type;
    const d = e.data ?? {};
    if (t === 'user/message') {
      // 工具回灌的用户消息不要
      if ((d.source?.kind ?? 'user') !== 'user') continue;
      const body = texts(d.content);
      if (!body || body === lastText) continue;
      items.push({ role: 'user', time: e.time, body, images: imagesOf(d.content) });
      lastText = body;
    } else if (t === 'assistant/message') {
      const body = texts(d.message?.content);
      if (!body || body === lastText) continue;
      items.push({ role: 'assistant', time: e.time, body, images: imagesOf(d.message?.content) });
      lastText = body;
    } else if (t === 'tool/call') {
      items.push({ role: 'tool', time: e.time, body: `⚙ ${d.name} ${clip(d.arguments, 160)}`, tool: true });
    }
  }

  return {
    meta: { title, id: meta.id, cwd: meta.cwd },
    items,
    warnings,
  };
}
