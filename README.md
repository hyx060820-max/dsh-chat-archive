# dsh-chat-archive

**给 AI 一份能翻回来的记忆。**

## 问题

新开一个对话，它从零开始。

你上周说过的事、抱怨过的那个 bug、约好的时间——全不在。
不是它故意忘，是它手里只有一段上下文。对话一关，那点东西就散了。

有人说真人也会忘。不一样。真人忘了还能想起来——
「上次你提过」，翻一翻就找到了。AI 连能翻的东西都没有。

## 这件事补的，就是「能翻的东西」

DSH 和 Codex 都会把会话落到本地，但落成了压缩的二进制。
一个 `.zstd` 里塞着几十万字，翻不动、搜不了、也没法直接给模型看。

每天跑一次，把它摊平：

- 一天一个 `聊天\YYYY-MM-DD.txt`，能 `grep`
- 图片跟着消息走，不再是一堆散落的 `sha256`
- 原始快照留着，能原样恢复
- 工具调用单独一份，追查用

于是「上次说过什么」变成一次搜索，而不是一次失忆。

## 记忆不是自动的

说清楚：**归档不等于记得。**

文件躺在硬盘上，模型不会自己去读。要它读，得有一条路：

- 说一句「看一下记忆」
- 让它在 `聊天\` 里搜关键词
- 或者装「记忆体」插件，在设置里选工作区、开关来源

这一步没做，它还是条金鱼。这一步做了，它才可能说「你上回提过」。

## 为什么不是数据库

不需要训练，不需要向量库，不需要另起服务。

它就是文件。纯文本、能搜、git 能盯 diff、记事本能打开。
哪天这仓库没人维护了，那些 `.txt` 还在。

## 像不像真人

真人靠记得细节显得具体。

记住你说过讨厌坐车，下次就不劝你回去一趟——这种事靠的不是模型更大，
是有一份能翻的账。

这个仓库做那份账。

## 支持哪些来源

| 格式 | agent | 会话在哪 |
|---|---|---|
| `dsh` | DSH（DeepSeek Harness） | `~/.dsh/sessions/<工作区>/<会话ID>/session.v4.jsonl.zstd` |
| `codex` | Codex CLI | `~/.codex/sessions/<年>/<月>/<日>/rollout-*.jsonl` |

DSH 那份是多帧 zstd 拼起来的，要自己切帧解压；Codex 是纯文本 JSONL。
差别都关在 `sources/` 里，导出和备份的逻辑不分叉。

## 依赖

- **Node.js**。DSH 的会话要 `zlib.zstdDecompressSync`，所以需要 **22.15 以上或 23.8 以上**；
  Codex 的会话是纯文本，老一点的 node 也能读
- **PowerShell 5.1+**，Windows 自带；Linux/macOS 用 `pwsh`
- 一个 DSH 或 Codex CLI 的安装，有历史会话可读

不知道自己的 node 够不够：

```powershell
node -e "console.log(typeof require('node:zlib').zstdDecompressSync === 'function' ? '有 zstd' : '没有 zstd')"
```

## 文件结构

```
backup-chat.ps1      调度：锁、挑会话、跑导出、校验、写记录
export-session.mjs   命令行入口：读参数、选格式、渲染成 txt 或 md
verify.ps1           十五项检查，提交前跑
server.mjs           本地界面服务（零依赖）
ui/index.html        界面本体（HTML + CSS + JS 全在一个文件里）
sources/
├─ index.mjs         格式登记处 + 自动识别
├─ dsh.mjs           多帧 zstd 解帧 + 事件映射
└─ codex.mjs         JSONL 逐行读 + 噪音过滤
.githooks/pre-push   推之前自动跑 verify.ps1
```

脚本不认识格式细节，格式细节也不知道怎么排版。中间那层只有四个字段：
`role`（`user` / `assistant` / `tool`）、`time`、`body`、`images`。

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

## 界面

不想记参数就开界面：

```powershell
node server.mjs
```

浏览器打开 <http://127.0.0.1:7788>。零依赖，不用装任何东西。

三块内容：

| 位置 | 管什么 |
|---|---|
| **来源开关** | DSH、Codex 各一个。关掉的那个一次都不跑，连目录都不读 |
| **工作区** | 勾哪些就只备份哪些。不勾「全部」时，选中的集合会传给 `-Workspace` |
| **输出** | 存档放哪儿、文本里怎么称呼双方 |

DSH 的工作区目录名是编码过的路径（`--C-Users-~9EC4~540C~5B66-.dsh-im--`），
界面会去会话第一帧里读真实 `cwd`，显示成 `C:\Users\...\.dsh\im` 这种样子。

点「立即备份」会先把当前设置存下来，再跑，跑完把这份记录贴出来。

配置存在仓库根目录的 `.config.json`，已进 `.gitignore`。删掉就回到默认。

服务只监听 `127.0.0.1`，没有登录，也没打算对外开。换端口：

```powershell
$env:PORT=9000; node server.mjs
```

用完 `Ctrl+C`。它不常驻，也不自动跑；要每天自动，还是用下面的计划任务。

## DSH 插件：记忆体

`plugin/` 是一个 DSH 插件，名字叫**记忆体**。装上之后，「设置 → 记忆体」里就有同样的
开关和按钮，不用另开网页。

```powershell
.\plugin\install.ps1
```

重启 DSH 生效。撤销：

```powershell
.\plugin\install.ps1 -Uninstall
```

装的时候会先备份 profile 的 `package.json`，改的只有一条依赖和一条 bundle。

插件**不含**备份逻辑——它调用本仓库的 `backup-chat.ps1`。所以插件里的「脚本目录」
要指向这份仓库。不重复实现是有意的：两套备份逻辑迟早会走岔。

插件里还有一个**自动备份**开关：设个时间，DSH 开着就到点自己跑，一天一次；
到了点但 DSH 没开，下次开起来会补一次。要关机也能跑，还是得用下面的计划任务。

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
| `-Workspace` | 空 | 只备份这几个工作区（数组）。空 = 全都要 |
| `-WorkspaceList` | 空 | 同上，逗号串写法，给界面这类调用方用 |
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

## 这些约定只在当前工作区生效

上面那套「改动 → 验证 → 推送」，连同 `.githooks/` 和 `AGENTS.md`，**只在这一个工作区里管事**。
别处不自动继承。

| 机制 | 存在哪 | 换个地方会怎样 |
|---|---|---|
| `AGENTS.md` | 仓库根目录的文件 | 换个工作目录干活，没人读它 |
| `core.hooksPath` | `.git/config`，本地配置 | 新克隆要重新 `git config` 一次 |
| `verify.ps1` 的真机检查 | 依赖本机 `~/.dsh`、`~/.codex` | 没有对应会话的机器上会跳过 |

换一台机器，三步：

```powershell
git clone https://github.com/hyx060820-max/dsh-chat-archive.git
cd dsh-chat-archive
git config core.hooksPath .githooks
```

`verify.ps1` 本身随仓库走，不用另装。

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

## 出问题先看这儿

| 症状 | 原因 | 怎么办 |
|---|---|---|
| `找不到会话文件` | 目录不对，或还没聊过 | 加 `-Sessions '真实目录'`；DSH 是 `~/.dsh/sessions` |
| 中文全是乱码 | `.ps1` 丢了 BOM | 存成 UTF-8 with BOM。`verify.ps1` 会查 |
| `没有 zstd 解压` | node 太老 | 装 22.15+ 或 23.8+；或者先只备份 Codex |
| 退出码 1，`备份记录.md` 有「需要注意」 | 有一条没备成 | 看那一节，原文件都还在，没被覆盖 |
| 条数变少，拒绝覆盖 | 会话文件读得不全 | 先别删旧的；把 `聊天\` 里那天的文件留着，查完再手动重跑 |
| push 被取消 | 验证没过 | 看终端输出，修完再推。想临时绕过：`git push --no-verify`（不建议） |
| 备份记录里天天「没有消息，跳过」 | 昨天确实没聊 | 正常，不是错误 |

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
