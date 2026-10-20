# dsh-chat-archive

把 AI agent 的会话按天存档成**人读得懂的文件**。

会话原文要么是二进制，要么是一大坨 JSONL，翻不动，也不好搜。这个工具每天跑一次，
把它摊平成纯文本、完整 markdown、和可原样恢复的原始快照。**永不自动删除。**

支持两种来源：

| 格式 | agent | 会话在哪 |
|---|---|---|
| `dsh` | DSH（DeepSeek Harness） | `~/.dsh/sessions/<工作区>/<会话ID>/session.v4.jsonl.zstd` |
| `codex` | Codex CLI | `~/.codex/sessions/<年>/<月>/<日>/rollout-*.jsonl` |

DSH 那份是多帧 zstd 拼起来的，要自己切帧解压；Codex 是纯文本 JSONL。
差别都关在 `sources/` 里，导出和备份的逻辑不分叉。

## 它解决什么

- 关掉对话框，聊天记录就只剩一个 `.zstd` 二进制。想翻三天前说过什么，得先解压
- 图片按 `sha256` 存，跟对话失去连接
- 想从某段对话里找关键词，`grep` 二进制没用

跑完之后，每天一个 `聊天\YYYY-MM-DD.txt`，直接搜。

## 依赖

- **Node.js ≥ 22.15**（或 23.8 以上）。用到 `zlib.zstdDecompressSync`，更老的版本没有
- **PowerShell 5.1+**，Windows 自带；Linux/macOS 用 `pwsh`
- 一个 DSH 或 Codex CLI 的安装，有历史会话可读

## 用起来

```powershell
git clone https://github.com/hyx060820-max/dsh-chat-archive.git
cd dsh-chat-archive

# 跑一次，默认写到 ~/dsh-memory
.\backup-chat.ps1

# 指定输出目录
.\backup-chat.ps1 -Root 'D:\archive'

# 只备份某一个会话（留空 = 最近有改动的那个）
.\backup-chat.ps1 -SessionId 'session-00000000-0000-4000-8000-000000000000'

# 备份 Codex CLI 的
.\backup-chat.ps1 -Format codex
```

会话 ID 就是 `~/.dsh/sessions/<工作区>/` 下的目录名。
Codex 那边一场对话一个 `rollout-*.jsonl`，不加 `-SessionId` 会把这两天动过的全收进来。

## 每天自动跑

```powershell
$p = "$HOME\Documents\dsh-chat-archive\backup-chat.ps1"

$a = New-ScheduledTaskAction -Execute 'powershell.exe' `
       -Argument "-NoProfile -ExecutionPolicy Bypass -File `"$p`""
$t = New-ScheduledTaskTrigger -Daily -At 23:00

Register-ScheduledTask -TaskName 'DshChatArchive' -Action $a -Trigger $t
```

删掉：`Unregister-ScheduledTask -TaskName 'DshChatArchive' -Confirm:$false`

## 产出

```
<Root>\2026-10-20\
├─ 原始\<工作区>\<会话ID>.zstd        当天快照，能原样恢复
├─ 聊天\2026-10-20.txt                纯聊天，一天一个文件
├─ 图片\<sha256>.png                  对话里引用到的图
├─ 完整\<工作区>__<会话ID>.md          带工具调用，追查用
└─ 备份记录.md                        备了什么、有没有问题
```

Codex 来源的原始文件叫 `原始\codex\<rollout 名>.jsonl`，会话 ID 就是文件名。
一天里聊过几场，就在同一个 `聊天\<日期>.txt` 里按时间并排放，每场一个表头。

聊天长这样：

```
================================================================
会话：随便聊聊
时间：2026-10-19 09:26 ~ 09:53　（20 条消息）
================================================================

[09:26] 你
你好

[09:26] 助理
嗯。

有什么想让我做的吗。
```

图片在文本里留一个短标记，前 12 位对得上文件名：

```
〔图：image.png · ffd83bdf1ba0〕
```

## 参数

| 参数 | 默认 | 说明 |
|---|---|---|
| `-Format` | `dsh` | 来源格式：`dsh` 或 `codex` |
| `-Sessions` | 按格式取（见上表） | 会话目录 |
| `-Pattern` | 按格式取 | 会话文件名通配 |
| `-Root` | `~/dsh-memory` | 输出根目录 |
| `-SessionId` | 空 | 只备份这个会话；空 = 最近改动的那个 |
| `-Exporter` | 同目录的 `export-session.mjs` | 导出器路径 |
| `-AssistantName` | `助理` | 文本里助手的显示名 |
| `-UserName` | `你` | 文本里用户的显示名 |
| `-Now` | 当前时间 | 测试用，假装现在是某天 |

## 导出器单独用

```powershell
node export-session.mjs <输入> <输出.md> [选项]
```

| 选项 | 说明 |
|---|---|
| `--format <名字>` | 会话格式，默认 `auto` 靠文件头猜 |
| `--txt` | 纯文本格式（默认 markdown） |
| `--plain` | 去掉工具调用，代码块换成〔代码略〕 |
| `--day YYYY-MM-DD` | 只导出这一天的消息 |
| `--append` | 追加，不覆盖 |
| `--attachments-dir <目录>` | 把引用到的图复制出来 |
| `--attachments-root <目录>` | 附件库根目录，默认 `~/.dsh/attachments/v1/objects` |
| `--assistant-name <名字>` | 助手显示名 |
| `--user-name <名字>` | 用户显示名 |

失败一律非 0 退出并说明原因，不会静默产出空文件。

## 防坏措施

脚本不是「跑一下看看」。它会在出错时停下并报出来。

- **锁文件**。两次运行撞上，后来的退出。`.lock` 超过 30 分钟视为残留，自动清
- **先写 `.tmp`，校验后再替换**。导出失败不会留下空文件
- **条数变少就拒绝覆盖**。新算出的消息数比原来少，保留原文件，原因写进备份记录
- **出错以非 0 退出**，`备份记录.md` 里有一节「需要注意」

三条里最关键的是第三条。会话文件只追加，正常不会变少。变少说明读错了——宁可留旧的。

## 改完先验证

改任何东西之后，跑一遍：

```powershell
.\verify.ps1
```

退出码 0 才算通过。它检查十一项：

- 两个 `.ps1` 的语法和 BOM
- 四个 `.mjs` 的语法（`node --check`）
- 拿真实会话跑一遍导出，DSH 和 Codex 各一次
- 自动识别不许认错
- 垃圾文件要拒（exit 4）
- 两种格式各做一次备份冒烟，产出齐全、无 `.tmp` / `.lock` 残留
- 仓库里没有个人路径、私人会话 ID
- 没有零宽空格这类看不见的字符

`.githooks/pre-push` 挂了钩子，push 时自动再跑一遍，不过就取消推送。
新克隆的机器要启用一次：

```powershell
git config core.hooksPath .githooks
```

没装 Codex 或没装 DSH 的机器，对应那几项显示跳过，不影响其余。

## 恢复

先**完全退出 DSH**，否则会话文件可能被写回。

```powershell
$Root = "$HOME\dsh-memory"
$Dest = "$HOME\.dsh\sessions"

Get-ChildItem $Root -Directory |
  Where-Object { $_.Name -match '^\d{4}-\d{2}-\d{2}$' } | Sort-Object Name |
  ForEach-Object {
    $src = Join-Path $_.FullName '原始'
    if (Test-Path $src) {
      Get-ChildItem $src -Directory | ForEach-Object {
        $ws  = $_.Name
        $dst = Join-Path (Join-Path $Dest $ws) $_.BaseName
        New-Item -ItemType Directory -Force -Path $dst | Out-Null
        Get-ChildItem $_.FullName -File | ForEach-Object {
          $target = Join-Path (Join-Path $Dest $ws) $_.BaseName
          New-Item -ItemType Directory -Force -Path $target | Out-Null
          Copy-Item $_.FullName (Join-Path $target 'session.v4.jsonl.zstd') -Force
        }
      }
    }
  }
```

按日期从早到晚叠加，越新的覆盖越旧的。

只找回某一段：去 `聊天\` 里搜关键字，看是哪一天，再从对应的 `原始\` 取那个 `.zstd`。

## 体积

实测一天 5–6 MB，主要是原始快照。会话文件本身在长大，每天拷的是整份，所以会越来越重。
粗算一年 2–4 GB。永不删除，这个数只往上走。

嫌大了，可以改成「只存当天追加的那几帧」，代价是恢复要按顺序拼。

## 已知限制

- **DSH 只备份一个会话**。多开对话框的，各跑一遍，`-SessionId` 不同即可
- **Codex 一场对话一个文件**，不加 `-SessionId` 时把两天内改动过的全并进来
- **原始快照只存当天的**。前几天的数据就在同一个会话文件里，不重复存
- **原始快照是整份拷贝**，不是增量
- **不含**：插件配置、凭据（`~/.dsh/.credentials.yaml`）、工作区里的文件。只备份聊天和聊天里的图
- **`.ps1` 必须带 UTF-8 BOM**。PowerShell 5.1 会把无 BOM 的 UTF-8 当 ANSI 读，中文乱码并报语法错。改脚本时注意别丢
- 备份出来的目录别提交进 git。`.gitignore` 已经挡了 `YYYY-MM-DD/`

## 加一种格式

`sources/` 里一个文件就是一种格式。导出一个对象：

```js
export const name = 'codex';             // 命令行里的 --format 值
export const label = 'Codex CLI';
export const patterns = ['rollout-*.jsonl'];
export function detect(file) { … }       // 靠文件头判断是不是这种
export function read(file) {             // 读出来交给渲染层
  return {
    meta: { title, id, cwd },
    items: [{ role: 'user' | 'assistant' | 'tool', time, body, images: [] }],
    warnings: [],
  };
}
```

然后在 `sources/index.mjs` 里 import 一下、加进 `adapters`。之后 `--format`
和自动识别都带上它；`backup-chat.ps1` 只要在 `-Format` 的 `ValidateSet` 里
补一个名字。

`role` 只认三种。渲染、分天、去重、条数校验都不需要知道是谁家的 agent。

## 许可

MIT。
