// 记忆体 · Host 半
//
// 在 DSH 的 webServer 上开三个路由（都过「回环 + 同源」闸）：
//   GET  /dsh-memory/state     设置 + 扫出来的工作区 + 最近一份记录
//   POST /dsh-memory/settings  部分写入
//   POST /dsh-memory/run       按启用的来源跑备份
//
// 真正的备份逻辑在仓库里（backup-chat.ps1 + export-session.mjs）。
// 这个插件只负责：界面、存设置、把参数拼好、把脚本叫起来。
//
// 存储：$DSH_HOME/dsh-memory/settings.json
import { execFile } from 'node:child_process';
import { openSync, closeSync, readSync, mkdirSync, readFileSync, writeFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { homedir } from 'node:os';
import zlib from 'node:zlib';

const DATA_DIR = join(process.env.DSH_HOME || join(homedir(), '.dsh'), 'dsh-memory');
const SETTINGS_FILE = join(DATA_DIR, 'settings.json');
const name = 'dsh-memory';
const inject = ['webServer'];

const DEFAULTS = {
  repo: 'D:\\AI\\dsh-work',
  root: '~/dsh-memory',
  assistantName: '助理',
  userName: '你',
  sources: {
    dsh: { enabled: true, all: true, workspaces: [] },
    codex: { enabled: false },
    workbuddy: { enabled: false },
  },
  // 到点自己跑。只在 DSH 开着的时候有效
  schedule: { enabled: false, at: '23:00', lastRun: null },
};

const expand = (p) => (p && p.startsWith('~') ? join(homedir(), p.slice(1)) : p);

function readSettings() {
  let saved = {};
  try {
    saved = JSON.parse(readFileSync(SETTINGS_FILE, 'utf8'));
  } catch {
    /* 第一次跑，没有就算了 */
  }
  return {
    ...DEFAULTS,
    ...saved,
    sources: {
      dsh: { ...DEFAULTS.sources.dsh, ...(saved.sources?.dsh ?? {}) },
      codex: { ...DEFAULTS.sources.codex, ...(saved.sources?.codex ?? {}) },
      workbuddy: { ...DEFAULTS.sources.workbuddy, ...(saved.sources?.workbuddy ?? {}) },
    },
    schedule: { ...DEFAULTS.schedule, ...(saved.schedule ?? {}) },
  };
}

function writeSettings(s) {
  mkdirSync(DATA_DIR, { recursive: true });
  writeFileSync(SETTINGS_FILE, JSON.stringify(s, null, 2) + '\n', 'utf8');
}

// ── 扫工作区 ────────────────────────────────────────────────
// 目录名是编码过的路径，真实 cwd 在会话第一帧的 session 事件里
function firstCwd(file) {
  const MAGIC = Buffer.from([0x28, 0xb5, 0x2f, 0xfd]);
  let fd;
  try {
    fd = openSync(file, 'r');
    const b = Buffer.alloc(1 << 20);
    const n = readSync(fd, b, 0, b.length, 0);
    const head = b.subarray(0, n);
    const start = head.indexOf(MAGIC);
    if (start < 0) return null;
    const end = head.indexOf(MAGIC, start + 4);
    const slice = end > start ? head.subarray(start, end) : head.subarray(start);
    const text = zlib.zstdDecompressSync(slice).toString('utf8');
    for (const line of text.split('\n')) {
      if (!line.trim()) continue;
      try {
        const o = JSON.parse(line);
        if (o.type === 'session' && o.cwd) return o.cwd;
      } catch {
        /* 半行跳过 */
      }
    }
  } catch {
    /* 解不开就退回目录名 */
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
  return null;
}

function scanDsh(root) {
  const base = expand(root);
  if (!existsSync(base)) return { exists: false, workspaces: [] };
  const out = [];
  for (const d of readdirSync(base, { withFileTypes: true })) {
    if (!d.isDirectory()) continue;
    const wdir = join(base, d.name);
    let sessions = 0;
    let last = 0;
    let newest = null;
    try {
      for (const s of readdirSync(wdir, { withFileTypes: true })) {
        if (!s.isDirectory()) continue;
        const f = join(wdir, s.name, 'session.v4.jsonl.zstd');
        if (!existsSync(f)) continue;
        sessions++;
        const mt = statSync(f).mtimeMs;
        if (mt > last) {
          last = mt;
          newest = f;
        }
      }
    } catch {
      continue;
    }
    if (!sessions) continue;
    out.push({ name: d.name, label: newest ? firstCwd(newest) : null, sessions, last });
  }
  out.sort((a, b) => b.last - a.last);
  return { exists: true, root: base, workspaces: out };
}

function latestLog(s) {
  const root = expand(s.root);
  if (!existsSync(root)) return null;
  const days = readdirSync(root, { withFileTypes: true })
    .filter((d) => d.isDirectory() && /^\d{4}-\d{2}-\d{2}$/.test(d.name))
    .map((d) => d.name)
    .sort();
  if (!days.length) return null;
  const day = days[days.length - 1];
  const f = join(root, day, '备份记录.md');
  return existsSync(f) ? { day, text: readFileSync(f, 'utf8') } : null;
}

// ── 跑备份 ──────────────────────────────────────────────────
function runBackup(s, format) {
  return new Promise((resolvePromise) => {
    const script = join(expand(s.repo), 'backup-chat.ps1');
    if (!existsSync(script)) {
      return resolvePromise({ format, code: -1, out: `找不到脚本：${script}\n在设置里改一下「脚本目录」。` });
    }
    const args = [
      '-NoProfile', '-ExecutionPolicy', 'Bypass',
      '-File', script,
      '-Format', format,
      '-Root', expand(s.root),
      '-AssistantName', s.assistantName,
      '-UserName', s.userName,
    ];
    const src = s.sources[format] ?? {};
    if (format === 'dsh' && !src.all && src.workspaces?.length) {
      args.push('-WorkspaceList', src.workspaces.join(','));
    }
    const opts = { cwd: expand(s.repo), timeout: 180000, windowsHide: true, maxBuffer: 4 << 20 };
    const exes = [process.env.PWSH, 'pwsh', 'powershell'].filter(Boolean);
    const attempt = (i) => {
      if (i >= exes.length) return resolvePromise({ format, code: -1, out: '找不到 PowerShell（pwsh / powershell 都不在 PATH 上）' });
      execFile(exes[i], args, opts, (err, stdout, stderr) => {
        if (err && (err.code === 'ENOENT' || err.code === 'EACCES')) return attempt(i + 1);
        resolvePromise({
          format,
          code: typeof err?.code === 'number' ? err.code : err ? -1 : 0,
          out: `${stdout ?? ''}${stderr ?? ''}`.trim(),
        });
      });
    };
    attempt(0);
  });
}

const dayKey = (d) => {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};

// 手动和定时走同一条路
async function runEnabled(s) {
  const wanted = ['dsh', 'codex', 'workbuddy'].filter((k) => s.sources[k]?.enabled);
  if (!wanted.length) return { ok: false, error: '两个来源都关着', results: [] };
  const results = [];
  for (const f of wanted) results.push(await runBackup(s, f));
  return { ok: results.every((r) => r.code === 0), results, lastLog: latestLog(s) };
}

// ── 路由 ────────────────────────────────────────────────────
const LOCAL_HOST_RE = /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/i;

function trustedRequest(req) {
  const { host = '', origin = '' } = req.headers ?? {};
  if (typeof host !== 'string' || !LOCAL_HOST_RE.test(host)) return false;
  if (origin === '') return true;
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}

const JSON_HEADERS = { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' };
const sendJson = (res, status, payload) => {
  const body = JSON.stringify(payload);
  res.writeHead(status, { ...JSON_HEADERS, 'Content-Length': String(Buffer.byteLength(body)) });
  res.end(body);
};

const readJson = (req) =>
  new Promise((ok, fail) => {
    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > 1 << 20) fail(new Error('请求体太大'));
      chunks.push(c);
    });
    req.on('end', () => {
      try {
        const raw = Buffer.concat(chunks).toString('utf8');
        ok(raw.trim() ? JSON.parse(raw) : {});
      } catch {
        fail(new Error('不是合法 JSON'));
      }
    });
    req.on('error', fail);
  });

// 「关于我」：提炼过的稳定事实，和流水账分开放
function meInfo(s) {
  const f = join(expand(s.root), '关于我.md');
  if (!existsSync(f)) return { exists: false, path: f };
  const st = statSync(f);
  return { exists: true, path: f, mtime: st.mtimeMs, text: readFileSync(f, 'utf8') };
}

function statePayload(s) {
  return {
    ok: true,
    settings: s,
    paths: { root: expand(s.root), repo: expand(s.repo) },
    node: process.version,
    me: meInfo(s),
    dsh: scanDsh(join(process.env.DSH_HOME || join(homedir(), '.dsh'), 'sessions')),
    lastLog: latestLog(s),
  };
}

function apply(ctx) {
  mkdirSync(DATA_DIR, { recursive: true });
  const disposers = [];
  const on = (path, handler) => {
    disposers.push(
      ctx.webServer.register({
        kind: 'exact',
        path,
        handler: (req, res) => {
          if (!trustedRequest(req)) return sendJson(res, 403, { ok: false, error: 'untrusted origin' });
          Promise.resolve()
            .then(() => handler(req, res))
            .catch((err) => sendJson(res, 400, { ok: false, error: String(err?.message ?? err) }));
        },
      }),
    );
  };

  on('/dsh-memory/state', (req, res) => sendJson(res, 200, statePayload(readSettings())));

  on('/dsh-memory/settings', async (req, res) => {
    if (req.method !== 'POST') return sendJson(res, 200, { ok: true, settings: readSettings() });
    const patch = await readJson(req);
    const cur = readSettings();
    const next = {
      ...cur,
      ...(patch.settings ?? {}),
      sources: {
        dsh: { ...cur.sources.dsh, ...(patch.settings?.sources?.dsh ?? {}) },
        codex: { ...cur.sources.codex, ...(patch.settings?.sources?.codex ?? {}) },
        workbuddy: { ...cur.sources.workbuddy, ...(patch.settings?.sources?.workbuddy ?? {}) },
      },
      schedule: { ...cur.schedule, ...(patch.settings?.schedule ?? {}) },
    };
    if (!/^([01]?\d|2[0-3]):[0-5]\d$/.test(String(next.schedule.at ?? ''))) {
      return sendJson(res, 400, { ok: false, error: `时间要写成 HH:mm，收到：${next.schedule.at}` });
    }
    if (!next.repo || !existsSync(join(expand(next.repo), 'backup-chat.ps1'))) {
      return sendJson(res, 400, { ok: false, error: `脚本目录里没有 backup-chat.ps1：${next.repo}` });
    }
    writeSettings(next);
    sendJson(res, 200, { ok: true, settings: next });
  });

  on('/dsh-memory/run', async (req, res) => {
    const r = await runEnabled(readSettings());
    if (r.error) return sendJson(res, 400, { ok: false, error: r.error });
    sendJson(res, 200, r);
  });

  // 到点自己跑。每 30 秒看一眼钟，不精确到秒，够用
  let running = false;
  const tick = async () => {
    if (running) return;
    const s = readSettings();
    const sc = s.schedule ?? {};
    if (!sc.enabled) return;

    const now = new Date();
    const today = dayKey(now);
    const m = /^(\d{1,2}):(\d{2})$/.exec(String(sc.at ?? ''));
    if (!m) return;
    const target = new Date(now);
    target.setHours(Number(m[1]), Number(m[2]), 0, 0);

    // 还没到点，或者今天已经跑过
    if (now < target) return;
    if (sc.lastRun?.day === today) return;

    running = true;
    try {
      const r = await runEnabled(s);
      const next = readSettings();
      next.schedule = {
        ...next.schedule,
        lastRun: {
          day: today,
          at: new Date().toISOString(),
          ok: !!r.ok,
          note: r.error ?? (r.results ?? []).map((x) => `${x.format} exit ${x.code}`).join('，'),
        },
      };
      writeSettings(next);
    } catch (e) {
      const next = readSettings();
      next.schedule = { ...next.schedule, lastRun: { day: today, at: new Date().toISOString(), ok: false, note: String(e?.message ?? e) } };
      writeSettings(next);
    } finally {
      running = false;
    }
  };

  const timer = setInterval(() => {
    tick().catch(() => {});
  }, 30000);
  if (typeof timer.unref === 'function') timer.unref();
  // 启动时也看一眼：今天点已经过了、还没跑过，就补上
  const boot = setTimeout(() => {
    tick().catch(() => {});
  }, 5000);
  if (typeof boot.unref === 'function') boot.unref();

  ctx.effect(() => () => {
    clearInterval(timer);
    clearTimeout(boot);
  });

  ctx.effect(() => () => {
    for (const d of disposers) d();
  });
}

export { apply, inject, name };
