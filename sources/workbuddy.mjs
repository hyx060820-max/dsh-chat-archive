// WorkBuddy（腾讯）会话：一行一事件的 JSONL
//
// 文件位置：~/.workbuddy/projects/<项目目录>/<会话ID>.jsonl
// 事件类型：
//   session-meta            会话元信息
//   message                 正文，role = user / assistant
//   ai-title                会话标题（可能多次改写，取最后一条）
//   function_call           工具调用
//   function_call_result    工具结果（不单独渲染）
//   reasoning               思考过程
//   file-history-snapshot   快照，跟聊天无关
//
// 注意：用户消息前面常带一段 <system-reminder> 注入内容（系统提示、模式切换），
// 那不是人说的话，要剥掉。
import fs from 'node:fs';

export const name = 'workbuddy';
export const label = 'WorkBuddy（腾讯）';
export const patterns = ['*.jsonl'];

const stripReminder = (s) =>
  String(s ?? '')
    .replace(/<system-reminder[\s\S]*?<\/system-reminder>/g, '')
    .trim();

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
    const b = Buffer.alloc(8192);
    const n = fs.readSync(fd, b, 0, 8192, 0);
    const head = b.subarray(0, n).toString('utf8').replace(/^\uFEFF/, '');
    const firstLine = head.split('\n')[0];
    if (!firstLine.startsWith('{')) return false;
    try {
      return JSON.parse(firstLine)?.type === 'session-meta';
    } catch {
      return firstLine.includes('"type":"session-meta"');
    }
  } catch {
    return false;
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
  }
}

export function read(file) {
  const raw = fs.readFileSync(file, 'utf8');
  const lines = raw.split('\n');
  const events = [];
  let bad = 0;
  for (const l of lines) {
    if (!l.trim()) continue;
    try {
      events.push(JSON.parse(l));
    } catch {
      bad++;
    }
  }
  if (events.length === 0) throw new Error('没有解析出任何事件');

  const warnings = [];
  if (bad > 0) warnings.push(`${bad} 行解析失败，已跳过`);

  let title = null;
  let cwd = null;
  let sessionId = null;

  const items = [];
  let lastText = '';
  for (const o of events) {
    if (o.sessionId && !sessionId) sessionId = o.sessionId;
    if (o.cwd && !cwd) cwd = o.cwd;

    if (o.type === 'ai-title' && o.aiTitle) {
      title = o.aiTitle;
      continue;
    }
    if (o.type === 'message') {
      let body = texts(o.content);
      if (o.role === 'user') body = stripReminder(body);
      if (!body || body === lastText) continue;
      if (o.role !== 'user' && o.role !== 'assistant') continue;
      items.push({ role: o.role, time: o.timestamp, body, images: [] });
      lastText = body;
      continue;
    }
    if (o.type === 'function_call') {
      items.push({ role: 'tool', time: o.timestamp, body: `⚙ ${o.name} ${clip(o.arguments, 160)}`, tool: true });
    }
  }

  const firstUser = items.find((i) => i.role === 'user');
  return {
    meta: {
      title: title ?? (firstUser ? clip(firstUser.body, 30) : '未命名会话'),
      id: sessionId ?? file,
      cwd: cwd ?? undefined,
    },
    items,
    warnings,
  };
}
