# 记忆体（dsh-memory）

DSH 插件。把 DSH 和 Codex 的会话按天存档，入口在**设置**里。

## 装

```powershell
.\install.ps1
```

装完重启 DSH。设置页左侧会出现「记忆体」。

撤销：

```powershell
.\install.ps1 -Uninstall
```

## 里面有什么

| 控件 | 作用 |
|---|---|
| DSH 开关 | 关掉就完全不跑 DSH 那一半 |
| 全部工作区 | 勾上备份所有工作区；不勾就只备份勾选的那几个 |
| Codex 开关 | 同上，针对 Codex CLI |
| 存档目录 | 产出放哪儿 |
| 脚本目录 | `backup-chat.ps1` 所在目录，插件不复制脚本，直接调用仓库里那份 |
| 立即备份 | 先存设置，再跑 |

## 边界

- 插件**不含**备份逻辑。真正的活是仓库根目录的 `backup-chat.ps1` 和
  `export-session.mjs` 干的。插件只负责界面、存设置、把参数拼好、把脚本叫起来。
- 所以「脚本目录」必须指向一份可用的仓库；改了路径要在这里同步。
- 设置存在 `$DSH_HOME/dsh-memory/settings.json`。
- 三个路由都过「回环 + 同源」检查，只有本机的界面能调。

## 文件

```
lib/index.js     Host 半：三个路由，扫工作区，调用脚本
lib/client.js    Client 半：设置页那一节
cordis.patch.yml bundle 层，把自己插进组装树
install.ps1      装 / 卸
```
