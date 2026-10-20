# 工作约定

## 改动 → 验证 → 推送

这个仓库的规则：**每次改动之后，先跑验证，通过了才提交和推送。**

```powershell
.\verify.ps1
```

退出码 0 才算通过。非 0 就修，别推。

`.githooks/pre-push` 已经挂了钩子，push 时会自动再跑一遍，不过就取消推送。
新克隆的机器要启用一次：

```powershell
git config core.hooksPath .githooks
```

## 改 ps1 的注意

`backup-chat.ps1` 和 `verify.ps1` 必须存成 **UTF-8 with BOM**。
PowerShell 5.1 会把无 BOM 的 UTF-8 当 ANSI 读，中文乱码并报语法错。
`verify.ps1` 里有一项专门查这个。

## 加新 agent 的支持

见 README 的「加一种格式」。新增 `sources/<名字>.mjs`，登记到
`sources/index.mjs`，把名字补进 `backup-chat.ps1` 的 `-Format` ValidateSet，
最后在 `verify.ps1` 里加一项对应格式的导出自检。

## 别把私人东西写进仓库

`verify.ps1` 会扫个人路径和私人会话 ID。需要举例时用
`session-00000000-0000-4000-8000-000000000000` 这种假 ID。
