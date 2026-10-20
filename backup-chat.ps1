#Requires -Version 5.1
<#
.SYNOPSIS
  把 AI agent 的会话按天备份成可读文本、完整 markdown 和原始快照。

.DESCRIPTION
  每次运行处理两天：
    昨天 —— 收尾，整份重算，补上 23:00 之后到 0 点之间的尾巴
    今天 —— 刷新

  永不删除任何历史备份。

  支持两种来源：
    dsh    DSH（DeepSeek Harness）  ~/.dsh/sessions
    codex  Codex CLI                ~/.codex/sessions

  安全措施：
    锁文件      两次运行撞上时，后来的直接退出，不会互相踩
    临时文件    先写 .tmp，校验大小和条数后再替换
    条数下降    新条数比旧条数少时拒绝覆盖，原因写进备份记录

  注意：本文件必须保存为 UTF-8 with BOM。
  PowerShell 5.1 会把无 BOM 的 UTF-8 .ps1 当 ANSI 读，中文会乱码并报语法错。

.EXAMPLE
  .\backup-chat.ps1

.EXAMPLE
  .\backup-chat.ps1 -Format codex

.EXAMPLE
  .\backup-chat.ps1 -Root 'D:\archive' -SessionId 'session-00000000-0000-4000-8000-000000000000'
#>
[CmdletBinding()]
param(
  [ValidateSet('dsh', 'codex')]
  [string]$Format = 'dsh',
  [string]$Sessions = '',
  [string]$Root = '',
  [string]$SessionId = '',
  [string]$Pattern = '',
  [string]$Exporter = '',
  [string]$AssistantName = '助理',
  [string]$UserName = '你',
  # 只备份这几个工作区（DSH 的会话按工作区分目录）。留空 = 全都要
  [string[]]$Workspace = @(),
  # 同上，但用逗号串传。给不方便传数组的调用方（界面）用
  [string]$WorkspaceList = '',
  [datetime]$Now = (Get-Date)
)

$ErrorActionPreference = 'Continue'
try { [Console]::OutputEncoding = [Text.UTF8Encoding]::new($false) } catch { }

if (-not $Sessions) {
  $Sessions = if ($Format -eq 'codex') { Join-Path $HOME '.codex\sessions' } else { Join-Path $HOME '.dsh\sessions' }
}
if (-not $Root)     { $Root     = Join-Path $HOME 'dsh-memory' }
if (-not $Exporter) { $Exporter = Join-Path $PSScriptRoot 'export-session.mjs' }
if (-not $Pattern)  { $Pattern  = if ($Format -eq 'codex') { 'rollout-*.jsonl' } else { 'session.v4.jsonl.zstd' } }
$RawExt = if ($Format -eq 'codex') { '.jsonl' } else { '.zstd' }

# -WorkspaceList 只是 -Workspace 的字符串写法
if ($Workspace.Count -eq 0 -and $WorkspaceList) {
  $Workspace = @($WorkspaceList -split ',' | ForEach-Object { $_.Trim() } | Where-Object { $_ })
}

$LockPath  = Join-Path $Root '.lock'
$today     = $Now.ToString('yyyy-MM-dd')
$yesterday = $Now.AddDays(-1).ToString('yyyy-MM-dd')

if (-not (Test-Path $Sessions)) {
  Write-Host "会话目录不存在：$Sessions"
  exit 2
}
if (-not (Test-Path $Exporter)) {
  Write-Host "找不到导出器：$Exporter"
  exit 2
}
if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  Write-Host '找不到 node。先装 Node.js。'
  exit 2
}
$nodeVer = "$(& node -v 2>$null)".Trim().TrimStart('v')
if (-not $nodeVer) {
  Write-Host '读不到 node 版本。'
  exit 2
}
# DSH 的会话要 zstd 解压，node 22.15 之前没有这个 API。
# 不猜版本号，直接问 node 自己——23.0 到 23.7 也没有，只看主版本号会判错。
if ($Format -eq 'dsh') {
  & node -e "process.exit(typeof require('node:zlib').zstdDecompressSync === 'function' ? 0 : 1)" 2>$null
  if ($LASTEXITCODE -ne 0) {
    Write-Host "这个 node（v$nodeVer）没有 zstd 解压。DSH 的会话读不了。"
    Write-Host '要 v22.15 以上，或 v23.8 以上。Codex 的会话不受影响（-Format codex）。'
    exit 2
  }
}

New-Item -ItemType Directory -Force -Path $Root | Out-Null

# ── 锁：另一次在跑就直接退出 ──────────────────────────────────
$lock = $null
try {
  $lock = [IO.File]::Open($LockPath, 'CreateNew', 'ReadWrite', 'None')
} catch {
  $stale = $false
  if (Test-Path $LockPath) {
    $age = ((Get-Date) - (Get-Item $LockPath).LastWriteTime).TotalMinutes
    if ($age -gt 30) { $stale = $true }
  } else { $stale = $true }
  if ($stale) {
    Remove-Item $LockPath -Force -ErrorAction SilentlyContinue
    try { $lock = [IO.File]::Open($LockPath, 'CreateNew', 'ReadWrite', 'None') } catch { $lock = $null }
  }
  if (-not $lock) { Write-Host '另一次备份正在运行，本次跳过。'; exit 0 }
}

$problems = New-Object System.Collections.Generic.List[string]
$log = New-Object System.Collections.Generic.List[string]
$log.Add("# $today 备份记录")
$log.Add("")
$log.Add("执行时间：$($Now.ToString('yyyy-MM-dd HH:mm:ss'))")
$log.Add("来源格式：$Format")
$log.Add("Node：v$nodeVer")
$log.Add("会话目录：$Sessions")
$log.Add("输出目录：$Root")
$log.Add("")

$countPat = '^\[\d{2}:\d{2}\] '

try {
  $all = @(Get-ChildItem $Sessions -Recurse -File -Filter $Pattern -ErrorAction SilentlyContinue)

  # ── 只看指定的工作区 ──
  if ($Workspace.Count -gt 0 -and $all.Count -gt 0) {
    $base0 = $Sessions.TrimEnd('\')
    $all = @($all | Where-Object {
        $rel0 = $_.FullName.Substring($base0.Length).TrimStart('\')
        $parts0 = $rel0 -split '\\'
        $parts0.Count -ge 2 -and ($Workspace -contains $parts0[0])
      })
    $log.Add('限定工作区：' + ($Workspace -join ', '))
    $log.Add('')
  }

  # ── 挑要备份的会话 ──
  $targets = @()
  if ($SessionId) {
    $targets = @($all | Where-Object {
        $_.Name -like "*$SessionId*" -or $_.FullName -match "\\$([regex]::Escape($SessionId))\\"
      } | Sort-Object LastWriteTime -Descending | Select-Object -First 1)
    if ($targets.Count -eq 0) {
      $log.Add('注意：没找到指定的会话，改用最近有改动的那一个。')
      $log.Add('')
    }
  }
  if ($targets.Count -eq 0) {
    if ($Format -eq 'codex') {
      # Codex 一场对话一个文件，把这两天动过的都收进来
      $cut = $Now.Date.AddDays(-1)
      $targets = @($all | Where-Object { $_.LastWriteTime -ge $cut } | Sort-Object LastWriteTime)
    } else {
      $targets = @($all | Sort-Object LastWriteTime -Descending | Select-Object -First 1)
    }
  }

  if ($targets.Count -eq 0) {
    $log.Add('**没找到会话文件。**')
    $problems.Add('没找到会话文件')
  } else {
    # ── 认身份 ──
    $items = @()
    foreach ($t in $targets) {
      if ($Format -eq 'codex') {
        $ws  = 'codex'
        $sid = [IO.Path]::GetFileNameWithoutExtension($t.Name)
      } else {
        $base  = $Sessions.TrimEnd('\')
        $rel   = $t.FullName.Substring($base.Length).TrimStart('\')
        $parts = $rel -split '\\'
        $ws    = $parts[0]
        $sid   = $parts[1]
      }
      $items += [pscustomobject]@{ File = $t; Ws = $ws; Sid = $sid }
      $log.Add("会话：$sid  （$([math]::Round($t.Length / 1KB)) KB）")
    }
    $log.Add('')

    # ── 原始快照：今天的放当天文件夹 ──
    $todayRaw = Join-Path (Join-Path $Root $today) '原始'
    foreach ($it in $items) {
      $dir = Join-Path $todayRaw $it.Ws
      New-Item -ItemType Directory -Force -Path $dir | Out-Null
      Copy-Item $it.File.FullName (Join-Path $dir ($it.Sid + $RawExt)) -Force
    }

    # ── 聊天 txt：两天各一份，多会话并进同一文件 ──
    foreach ($day in @($yesterday, $today)) {
      $dayDir   = Join-Path $Root $day
      $rawDest  = Join-Path $dayDir '原始'
      $chatDest = Join-Path $dayDir '聊天'
      $fullDest = Join-Path $dayDir '完整'
      $picDest  = Join-Path $dayDir '图片'
      New-Item -ItemType Directory -Force -Path $rawDest, $chatDest, $fullDest, $picDest | Out-Null

      $chatFile = Join-Path $chatDest "$day.txt"
      $tmpFile  = "$chatFile.tmp"
      Remove-Item $tmpFile -Force -ErrorAction SilentlyContinue

      $fail = $null
      foreach ($it in $items) {
        $out = & node $Exporter $it.File.FullName $tmpFile --txt --day $day --append `
                 --format $Format --attachments-dir $picDest `
                 --assistant-name $AssistantName --user-name $UserName 2>&1
        if ($LASTEXITCODE -ne 0) {
          $fail = "exit $LASTEXITCODE：" + ("$out" -replace '\s+', ' ')
          break
        }
      }

      $oldCount = 0
      if (Test-Path $chatFile) {
        $oldCount = @(Select-String -Path $chatFile -Pattern $countPat -Encoding UTF8 -AllMatches).Count
      }

      if ($fail) {
        $problems.Add("$day 导出失败（$fail）")
        $log.Add("- $day：**导出失败**，原文件保留")
        Remove-Item $tmpFile -Force -ErrorAction SilentlyContinue
      } elseif (-not (Test-Path $tmpFile)) {
        $log.Add("- $day：没有消息，跳过")
      } elseif ((Get-Item $tmpFile).Length -lt 80) {
        $problems.Add("$day 导出的文件异常小")
        $log.Add("- $day：**导出文件异常**，原文件保留")
        Remove-Item $tmpFile -Force -ErrorAction SilentlyContinue
      } else {
        $newCount = @(Select-String -Path $tmpFile -Pattern $countPat -Encoding UTF8 -AllMatches).Count
        if ($newCount -lt $oldCount) {
          $problems.Add("$day 条数变少（$oldCount → $newCount），拒绝覆盖")
          $log.Add("- $day：**条数变少**（$oldCount → $newCount），拒绝覆盖")
          Remove-Item $tmpFile -Force -ErrorAction SilentlyContinue
        } else {
          Move-Item $tmpFile $chatFile -Force
          $delta = if ($newCount -gt $oldCount) { "（+$($newCount - $oldCount)）" } else { '' }
          $log.Add("- $day：$newCount 条消息$delta")
        }
      }

      # ── 完整版（带工具调用，追查用） ──
      foreach ($it in $items) {
        $fullFile = Join-Path $fullDest ("{0}__{1}.md" -f $it.Ws, $it.Sid)
        $fullTmp  = "$fullFile.tmp"
        Remove-Item $fullTmp -Force -ErrorAction SilentlyContinue
        $out2 = & node $Exporter $it.File.FullName $fullTmp --day $day `
                  --format $Format --assistant-name $AssistantName --user-name $UserName 2>&1
        if ($LASTEXITCODE -eq 0 -and (Test-Path $fullTmp) -and (Get-Item $fullTmp).Length -gt 80) {
          Move-Item $fullTmp $fullFile -Force
        } else {
          Remove-Item $fullTmp -Force -ErrorAction SilentlyContinue
        }
      }
    }
  }
}
catch {
  $problems.Add('脚本异常：' + $_.Exception.Message)
}
finally {
  if ($lock) { $lock.Close() }
  Remove-Item $LockPath -Force -ErrorAction SilentlyContinue
}

if ($problems.Count -gt 0) {
  $log.Add('')
  $log.Add('## 需要注意')
  foreach ($p in $problems) { $log.Add('- ' + $p) }
}

$log.Add('')
$log.Add('看聊天：聊天\<日期>.txt　图片：图片\　追查：完整\　原始数据：原始\')

$logDir = Join-Path $Root $today
New-Item -ItemType Directory -Force -Path $logDir | Out-Null

# 每个来源一份，最后合并成 备份记录.md。
# 否则两个来源各跑一遍，后跑的会把先跑的记录盖掉。
$logFile = Join-Path $logDir ("备份记录-{0}.md" -f $Format)
Set-Content -Path $logFile -Value $log -Encoding UTF8

$merged = Join-Path $logDir '备份记录.md'
$parts = @()
foreach ($f in (Get-ChildItem $logDir -Filter '备份记录-*.md' | Sort-Object Name)) {
  $parts += ('<!-- 来源：{0} -->' -f $f.BaseName.Replace('备份记录-', ''))
  $parts += (Get-Content $f.FullName -Encoding UTF8 -Raw).TrimEnd()
  $parts += ''
}
Set-Content -Path $merged -Value ($parts -join "`r`n") -Encoding UTF8

if ($problems.Count -gt 0) {
  Write-Host "备份完成，但有 $($problems.Count) 处需要看：$logFile"
  exit 1
}
Write-Host "备份完成：$Root  （$($Now.ToString('yyyy-MM-dd HH:mm'))）"
exit 0
