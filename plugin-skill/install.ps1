#Requires -Version 5.1
<#
.SYNOPSIS
  把「记忆体」技能装进 WorkBuddy 和 / 或 Codex。

.DESCRIPTION
  两边都认技能目录：
    WorkBuddy  ~/.workbuddy/skills/
    Codex      ~/.codex/skills/

  装法就是复制一个文件夹进去，不改任何注册表、不动它们的配置文件。
  卸载 = 删掉那个文件夹。

  注意：本文件必须保存为 UTF-8 with BOM。
#>
[CmdletBinding()]
param(
  [ValidateSet('workbuddy', 'codex', 'both')]
  [string]$Target = 'both',
  [string]$Repo = '',
  [switch]$Uninstall
)

$src = Join-Path $PSScriptRoot 'SKILL.md'
if (-not (Test-Path $src)) {
  Write-Host "缺 SKILL.md：$src"
  exit 2
}

if (-not $Repo) { $Repo = Split-Path $PSScriptRoot -Parent }
if (-not (Test-Path (Join-Path $Repo 'tools\memory.mjs'))) {
  Write-Host "这个目录不像仓库根：$Repo（找不到 tools\memory.mjs）"
  exit 2
}

# 插件里做归档时该用的格式
$targets = @()
if ($Target -eq 'workbuddy' -or $Target -eq 'both') {
  $targets += [pscustomobject]@{ Name = 'WorkBuddy'; Dir = Join-Path $HOME '.workbuddy\skills\memory-archive'; Format = 'workbuddy' }
}
if ($Target -eq 'codex' -or $Target -eq 'both') {
  $targets += [pscustomobject]@{ Name = 'Codex'; Dir = Join-Path $HOME '.codex\skills\memory-archive'; Format = 'codex' }
}

foreach ($t in $targets) {
  if ($Uninstall) {
    if (Test-Path $t.Dir) {
      Remove-Item $t.Dir -Recurse -Force
      Write-Host "$($t.Name)：已删除 $($t.Dir)"
    } else {
      Write-Host "$($t.Name)：本来就没装"
    }
    continue
  }

  New-Item -ItemType Directory -Force -Path $t.Dir | Out-Null
  $text = Get-Content $src -Raw -Encoding UTF8
  $text = $text.Replace('{{REPO}}', $Repo).Replace('{{FORMAT}}', $t.Format)
  [IO.File]::WriteAllText((Join-Path $t.Dir 'SKILL.md'), $text, [Text.UTF8Encoding]::new($false))
  Write-Host "$($t.Name)：已装到 $($t.Dir)"
}

if (-not $Uninstall) {
  Write-Host ''
  Write-Host "脚本目录：$Repo"
  Write-Host '重启对应应用后生效。想试一句：「搜一下记忆里关于语音的记录」。'
  Write-Host '卸载：.\install.ps1 -Uninstall'
}
