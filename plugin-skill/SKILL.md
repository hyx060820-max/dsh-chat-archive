---
name: memory-archive
slug: memory-archive
display_name: 记忆体
display_name_en: Memory Archive
description: "把聊天会话按天归档成能搜的文本，并在需要时找回以前说过的事。触发词：记忆、记忆体、归档、聊天记录、之前说过、上次提到。"
description_zh: "把聊天会话按天归档成能搜的文本，并在需要时找回以前说过的事。"
description_en: "Archive chat sessions by day into searchable text; look up what was said before."
summary: "给 agent 一份能翻回来的账：归档、搜索。"
category: productivity
version: "0.1.0"
user-invocable: true
---

# 记忆体

聊天记录不该随对话关掉就散掉。这个技能做两件事：**归档**、**搜回来**。

真正的活由仓库里的脚本干，你只负责调用。

## 两个命令

```powershell
# 归档（默认 dsh；也能 codex / workbuddy / all）
node "{{REPO}}\tools\memory.mjs" archive --format {{FORMAT}}

# 搜记忆
node "{{REPO}}\tools\memory.mjs" search 关键词 --days 30 --limit 20

# 有哪些天
node "{{REPO}}\tools\memory.mjs" days

# 关于我：提炼过的事实，不是流水账
node "{{REPO}}\tools\memory.mjs" me
node "{{REPO}}\tools\memory.mjs" me add "讨厌坐车" --section 基本
node "{{REPO}}\tools\memory.mjs" me forget 坐车
node "{{REPO}}\tools\memory.mjs" me confirm
```

## 关于我

存档目录里有一份 `关于我.md`。它是**提炼过的稳定事实**：住哪、做什么、讨厌什么、别拿什么话敷衍。

和聊天记录不是一回事：

| | 聊天记录 | 关于我 |
|---|---|---|
| 内容 | 每天每一句 | 几句结论 |
| 怎么用 | 需要时去搜 | **每次新对话先读** |

规则：

1. **新对话开始，先读它**：`node "{{REPO}}\tools\memory.mjs" me`
2. 读不到就说没有。**不要假装读过，也不要凭印象补**
3. 用户说出新的事实 → `me add "…"`，`--section` 可选 `基本` / `偏好` / `别踩的`
4. 用户说「记错了」→ 先 `me forget 关键词`，再 `me add` 正确的
5. **改完要跟用户说一句改了什么。** 悄悄改记忆比不记更糟
6. 「最后确认」超过 90 天，可以问一句「这些还准吗」

每次写入前会自动备份成 `关于我.md.bak`。写坏了能退回去。

存档默认在 `~/dsh-memory`，一天一个目录：

```
<存档>\2026-10-20\
├─ 聊天\2026-10-20.txt        纯文本，能搜
├─ 图片\                      对话里引用过的图
├─ 完整\                      带工具调用，追查用
├─ 原始\                      原样快照
└─ 备份记录.md
```

## 什么时候该用

**搜**（先搜再回答，别猜）：

- 用户说「之前」「上次」「你不是说过」「还记得吗」
- 用户问的某件事可能在他们过去的对话里出现过
- 需要引用用户的具体偏好、约定、历史决定

**归档**：

- 用户明确说「记一下」「归档」「存一份」
- 一段较长的任务收尾时
- 用户问「你会记得吗」

**不要**：

- 每次对话都归档（这是定时任务该干的事）
- 在没搜到的时候编造「你上次说过」——搜不到就说没找到

## 搜不到的时候

`search` 会打印「没有找到」。这时如实说没找到，不要拿印象补。

如果存档目录还不存在，先跑一次 `archive`。

## 边界

- 归档是**复制**，不删任何东西
- 只归档聊天和聊天里的图，不含凭据、插件配置、工作区文件
- 图片按 `sha256` 命名，文本里留了短标记对应
