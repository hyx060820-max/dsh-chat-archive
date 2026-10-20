// Codex CLI 会话：纯文本 JSONL，一行一个事件
//
// 文件位置：~/.codex/sessions/<年>/<月>/<日>/rollout-<时间>-<uuid>.jsonl
// 事件类型：session_meta / response_item / event_msg / turn_context / world_state / token_usage_record
//
// 只取 response_item 里的正文。event_msg 里是任务状态（task_started、token_count 之类），
// 没有正文，取了会重复。
import fs from 'node:fs';

export const name = 'codex';
export const label = 'Codex CLI';
export const patterns = ['rollout-*.jsonl'];

// 用户消息里被塞进去的环境说明，不是人说的话
const NOISE_PREFIXES = ['<environment_context>', '<user_instructions>', '<developer_context>'];

const texts = (content) =>
  (content ?? [])
    .filter((c) => typeof c?.text === 'string')
    .map((c) => c.text)
    .join('\n')
    .trim();

const clip = (s, n) => {
  s = String(s ?? '').replace(/\s+/g, ' ').trim();
  return s.length > n ? s.slice(0, n) + '…' : s;
};

export function detect(file) {
  let fd;
  try {
    fd = fs.openSync(file, 'r');
    const b = Buffer.alloc(65536);
    const n = fs.readSync(fd, b, 0, 65536, 0);
    let head = b.subarray(0, n).toString('utf8');
    if (head.charCodeAt(0) === 0xfeff) head = head.slice(1);
    // session_meta 那一行可能很长（带着完整 system prompt），
    // 所以不整行 JSON.parse，只在第一行里认特征。
    const firstLine = head.split('\n')[0];
    return firstLine.startsWith('{') && firstLine.includes('"type":"session_meta"');
  } catch {
    return false;
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
  }
}

export function read(file) {
  const raw = fs.readFileSync(file, 'utf8');
  const events = [];
  let badLines = 0;
  for (const l of raw.split('\n')) {
    if (!l.trim()) continue;
    try {
      events.push(JSON.parse(l));
    } catch {
      badLines++;
    }
  }
  if (events.length === 0) throw new Error('没有解析出任何事件');

  const warnings = [];
  const metaEvent = events.find((e) => e.type === 'session_meta') ?? {};
  const p = metaEvent.payload ?? {};

  const items = [];
  let lastText = '';

  for (const e of events) {
    const payload = e.payload ?? {};
    const time = e.timestamp ? Date.parse(e.timestamp) : null;
    if (e.type !== 'response_item') continue;

    if (payload.type === 'message') {
      const role = payload.role;
      if (role !== 'user' && role !== 'assistant') continue; // developer / system 丢掉
      let body = texts(payload.content);
      if (!body) continue;
      if (role === 'user' && NOISE_PREFIXES.some((x) => body.startsWith(x))) continue;
      if (body === lastText) continue;
      items.push({ role, time, body, images: [] });
      lastText = body;
    } else if (payload.type === 'function_call' || payload.type === 'custom_tool_call') {
      const nm = payload.name ?? payload.tool_name ?? 'tool';
      const args = payload.arguments ?? payload.input ?? '';
      items.push({ role: 'tool', time, body: `⚙ ${nm} ${clip(args, 160)}`, tool: true });
    }
  }

  // Codex 不写标题，用第一句用户话当标题
  const firstUser = items.find((i) => i.role === 'user');
  const title = firstUser ? clip(firstUser.body, 30) : p.session_id ?? '未命名会话';

  if (badLines > 0) warnings.push(`${badLines} 行解析失败，已跳过`);

  return {
    meta: {
      title,
      id: p.session_id ?? p.id ?? file,
      cwd: p.cwd ?? (Array.isArray(p.runtime_workspace_roots) ? p.runtime_workspace_roots[0] : undefined),
    },
    items,
    warnings,
  };
}
