// 本地界面服务：只监听 127.0.0.1，零依赖
//
//   node server.mjs            默认 http://127.0.0.1:7788
//   PORT=9000 node server.mjs  换端口
//
// 接口：
//   GET  /api/state    配置 + 扫出来的工作区 + 环境
//   POST /api/config   保存配置（.config.json）
//   POST /api/run      按启用的来源跑备份
//   GET  /api/log      最近一份备份记录
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import zlib from 'node:zlib';

const REPO = path.dirname(fileURLToPath(import.meta.url));
const CONFIG_PATH = path.join(REPO, '.config.json');
const BACKUP = path.join(REPO, 'backup-chat.ps1');
const UI = path.join(REPO, 'ui', 'index.html');
const PORT = Number(process.env.PORT || 7788);
const HOST = '127.0.0.1';

const DEFAULTS = {
  root: '~/dsh-memory',
  assistantName: '助理',
  userName: '你',
  sources: {
    dsh: { enabled: true, sessions: '~/.dsh/sessions', all: true, workspaces: [] },
    codex: { enabled: false, sessions: '~/.codex/sessions' },
  },
};

const expand = (p) => (p && p.startsWith('~') ? path.join(os.homedir(), p.slice(1)) : p);

function readConfig() {
  let saved = {};
  try {
    saved = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
  } catch {
    /* 第一次跑，没有就算了 */
  }
  return {
    ...DEFAULTS,
    ...saved,
    sources: {
      dsh: { ...DEFAULTS.sources.dsh, ...(saved.sources?.dsh ?? {}) },
      codex: { ...DEFAULTS.sources.codex, ...(saved.sources?.codex ?? {}) },
    },
  };
}

function writeConfig(cfg) {
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 2) + '\n', 'utf8');
}

// 目录名是编码过的路径（--C-Users-~9EC4~540C~5B66-.dsh-im--），人看不出来是哪儿。
// 真正的 cwd 写在会话第一帧的 session 事件里，只解第一帧就够。
function firstCwd(file) {
  const MAGIC = Buffer.from([0x28, 0xb5, 0x2f, 0xfd]);
  let fd;
  try {
    fd = fs.openSync(file, 'r');
    const head = Buffer.alloc(1 << 20);
    const n = fs.readSync(fd, head, 0, head.length, 0);
    const buf = head.subarray(0, n);
    let start = buf.indexOf(MAGIC);
    if (start < 0) return null;
    let end = buf.indexOf(MAGIC, start + 4);
    const slice = end > start ? buf.subarray(start, end) : buf.subarray(start);
    const text = zlib.zstdDecompressSync(slice).toString('utf8');
    for (const line of text.split('\n')) {
      if (!line.trim()) continue;
      try {
        const o = JSON.parse(line);
        // cwd 在顶层，不在 data 里
        if (o.type === 'session' && o.cwd) return o.cwd;
      } catch {
        /* 半行就算了 */
      }
    }
  } catch {
    /* 解不开就退回目录名 */
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
  }
  return null;
}

// ── 扫工作区 ────────────────────────────────────────────────
// DSH: <root>/<工作区目录>/<会话ID>/session.v4.jsonl.zstd
// Codex: 一场对话一个 rollout，不分工作区
function scanDsh(sessionsRoot) {
  const root = expand(sessionsRoot);
  if (!fs.existsSync(root)) return { exists: false, workspaces: [] };

  const workspaces = [];
  for (const d of fs.readdirSync(root, { withFileTypes: true })) {
    if (!d.isDirectory()) continue;
    const wdir = path.join(root, d.name);
    let sessions = 0;
    let last = 0;
    let newest = null;
    try {
      for (const s of fs.readdirSync(wdir, { withFileTypes: true })) {
        if (!s.isDirectory()) continue;
        const f = path.join(wdir, s.name, 'session.v4.jsonl.zstd');
        if (!fs.existsSync(f)) continue;
        sessions++;
        const mt = fs.statSync(f).mtimeMs;
        if (mt > last) {
          last = mt;
          newest = f;
        }
      }
    } catch {
      continue;
    }
    if (sessions === 0) continue;
    workspaces.push({ name: d.name, label: newest ? firstCwd(newest) : null, sessions, last });
  }
  workspaces.sort((a, b) => b.last - a.last);
  return { exists: true, root, workspaces };
}

function scanCodex(sessionsRoot) {
  const root = expand(sessionsRoot);
  if (!fs.existsSync(root)) return { exists: false, files: 0, last: 0 };

  let files = 0;
  let last = 0;
  const walk = (dir) => {
    for (const d of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, d.name);
      if (d.isDirectory()) walk(full);
      else if (d.name.startsWith('rollout-') && d.name.endsWith('.jsonl')) {
        files++;
        last = Math.max(last, fs.statSync(full).mtimeMs);
      }
    }
  };
  try {
    walk(root);
  } catch {
    /* 读不动就当没有 */
  }
  return { exists: true, root, files, last };
}

function latestLog(cfg) {
  const root = expand(cfg.root);
  if (!fs.existsSync(root)) return null;
  const days = fs
    .readdirSync(root, { withFileTypes: true })
    .filter((d) => d.isDirectory() && /^\d{4}-\d{2}-\d{2}$/.test(d.name))
    .map((d) => d.name)
    .sort();
  if (!days.length) return null;
  const day = days.at(-1);
  const file = path.join(root, day, '备份记录.md');
  if (!fs.existsSync(file)) return null;
  return { day, text: fs.readFileSync(file, 'utf8') };
}

// ── 跑备份 ──────────────────────────────────────────────────
function runBackup(cfg, format) {
  return new Promise((resolve) => {
    const s = cfg.sources[format];
    const args = [
      '-NoProfile', '-ExecutionPolicy', 'Bypass',
      '-File', BACKUP,
      '-Format', format,
      '-Root', expand(cfg.root),
      '-AssistantName', cfg.assistantName,
      '-UserName', cfg.userName,
    ];
    if (s.sessions && expand(s.sessions) !== expand(DEFAULTS.sources[format].sessions)) {
      args.push('-Sessions', expand(s.sessions));
    }
    if (format === 'dsh' && !s.all && s.workspaces?.length) {
      // 工作区名都是 ASCII（非 ASCII 会被编码成 ~XXXX~），用逗号串传最稳
      args.push('-WorkspaceList', s.workspaces.join(','));
    }

    const done = (code, out) => resolve({ format, code, out: String(out ?? '').trim(), at: Date.now() });
    const opts = { cwd: REPO, timeout: 180000, windowsHide: true, maxBuffer: 4 << 20 };

    // 有的机器只有 powershell.exe，有的只有 pwsh。ENOENT 是异步来的，
    // 所以不能靠 try/catch 兜，得在回调里换下一个再试。
    const exes = [process.env.PWSH, 'pwsh', 'powershell'].filter(Boolean);
    const attempt = (i) => {
      if (i >= exes.length) return done(-1, '找不到 PowerShell（pwsh 或 powershell 都不在 PATH 上）');
      execFile(exes[i], args, opts, (err, stdout, stderr) => {
        if (err && (err.code === 'ENOENT' || err.code === 'EACCES')) return attempt(i + 1);
        done(typeof err?.code === 'number' ? err.code : err ? -1 : 0, `${stdout ?? ''}${stderr ?? ''}`);
      });
    };
    attempt(0);
  });
}

// ── HTTP ────────────────────────────────────────────────────
const json = (res, code, obj) => {
  const body = JSON.stringify(obj);
  res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(body);
};

const readBody = (req) =>
  new Promise((resolve, reject) => {
    // 先收字节再解码。逐块 toString 会把跨块的多字节字符切坏
    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > 1 << 20) return reject(new Error('请求体太大'));
      chunks.push(c);
    });
    req.on('end', () => {
      try {
        const raw = Buffer.concat(chunks).toString('utf8');
        resolve(raw.trim() ? JSON.parse(raw) : {});
      } catch {
        reject(new Error('不是合法 JSON'));
      }
    });
    req.on('error', reject);
  });

// Windows 路径里不可能出现的字符。出现了，多半是上游编码坏了（中文变成 ?）
const ILLEGAL = /[<>"|?*\u0000-\u001f]/;
const looksBroken = (p) => ILLEGAL.test(String(p ?? ''));

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${HOST}:${PORT}`);

  try {
    if (req.method === 'GET' && (url.pathname === '/' || url.pathname === '/index.html')) {
      if (!fs.existsSync(UI)) return json(res, 500, { error: '缺 ui/index.html' });
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
      return res.end(fs.readFileSync(UI));
    }

    if (req.method === 'GET' && url.pathname === '/api/state') {
      const cfg = readConfig();
      return json(res, 200, {
        config: cfg,
        paths: { root: expand(cfg.root), repo: REPO, backup: BACKUP },
        dsh: scanDsh(cfg.sources.dsh.sessions),
        codex: scanCodex(cfg.sources.codex.sessions),
        node: process.version,
        lastLog: latestLog(cfg),
      });
    }

    if (req.method === 'POST' && url.pathname === '/api/config') {
      const body = await readBody(req);
      const cfg = readConfig();
      const next = {
        ...cfg,
        ...body.config,
        sources: {
          dsh: { ...cfg.sources.dsh, ...(body.config?.sources?.dsh ?? {}) },
          codex: { ...cfg.sources.codex, ...(body.config?.sources?.codex ?? {}) },
        },
      };
      if (looksBroken(next.root)) {
        return json(res, 400, { error: `输出目录里有非法字符：${next.root}。通常是编码坏了，中文变成了 ?` });
      }
      writeConfig(next);
      return json(res, 200, { ok: true, config: next });
    }

    if (req.method === 'POST' && url.pathname === '/api/run') {
      const cfg = readConfig();
      const wanted = ['dsh', 'codex'].filter((k) => cfg.sources[k].enabled);
      if (!wanted.length) return json(res, 400, { error: '两个来源都关着，没得跑' });
      for (const k of wanted) {
        if (looksBroken(cfg.sources[k].sessions)) {
          return json(res, 400, { error: `${k} 的会话目录里有非法字符：${cfg.sources[k].sessions}` });
        }
      }
      if (looksBroken(expand(cfg.root))) {
        return json(res, 400, { error: `输出目录里有非法字符：${cfg.root}` });
      }
      const results = [];
      for (const f of wanted) results.push(await runBackup(cfg, f));
      return json(res, 200, { ok: results.every((r) => r.code === 0), results, lastLog: latestLog(cfg) });
    }

    if (req.method === 'GET' && url.pathname === '/api/log') {
      const cfg = readConfig();
      return json(res, 200, { log: latestLog(cfg) });
    }

    json(res, 404, { error: '没有这个接口' });
  } catch (e) {
    json(res, 500, { error: String(e?.message ?? e) });
  }
});

server.listen(PORT, HOST, () => {
  console.log(`界面：http://${HOST}:${PORT}`);
  console.log(`配置：${CONFIG_PATH}`);
  console.log('只监听本机。用完 Ctrl+C 关掉。');
});
