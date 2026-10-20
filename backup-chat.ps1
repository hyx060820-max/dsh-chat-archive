#Requires -Version 5.1
<#
.SYNOPSIS
  把 DSH 会话按天备份成可读文本、完整 markdown 和原始快照。

.DESCRIPTION
  每次运行处理两天：
    昨天 —— 收尾，整份重算，补上 23:00 之后到 0 点之间的尾巴
    今天 —— 刷新

  永不删除任何历史备份。

  安全措施：
    锁文件      两次运行撞上时，后来的直接退出，不会互相踩
    临时文件    先写 .tmp，校验大小和条数后再替换
    条数下降    新条数比旧条数少时拒绝覆盖，原因写进备份记录

  注意：本文件必须保存为 UTF-8 with BOM。
  PowerShell 5.1 会把无 BOM 的 UTF-8 .ps1 当 ANSI 读，中文会乱码并报语法错。

.EXAMPLE
  .\backup-chat.ps1

.EXAMPLE
  .\backup-chat.ps1 -Root 'D:\archive' -SessionId 'session-00000000-0000-4000-8000-000000000000'
#>
[CmdletBinding()]
param(
  [string]$Sessions = '',
  [string]$Root = '',
  [string]$SessionId = '',
  [string]$Exporter = '',
  [string]$AssistantName = '助理',
  [string]$UserName = '你',
  [datetime]$Now = (Get-Date)
)

$ErrorActionPreference = 'Continue'
try { [Console]::OutputEncoding = [Text.UTF8Encoding]::new($false) } catch { }

if (-not $Sessions) { $Sessions = Join-Path $HOME '.dsh\sessions' }
if (-not $Root)     { $Root     = Join-Path $HOME 'dsh-memory' }
if (-not $Exporter) { $Exporter = Join-Path $PSScriptRoot 'export-session.mjs' }

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
  Write-Host '找不到 node。先装 Node.js 22.15 或更高版本。'
  exit 2
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
$log.Add("会话目录：$Sessions")
$log.Add("输出目录：$Root")
$log.Add("")

try {
  $all = @(Get-ChildItem $Sessions -Recurse -Filter 'session.v4.jsonl.zstd' -ErrorAction SilentlyContinue)
  $target = $null
  if ($SessionId) {
    $target = $all | Where-Object { $_.FullName -match "\\$([regex]::Escape($SessionId))\\" } | Select-Object -First 1
  }
  if (-not $target) {
    $target = $all | Sort-Object LastWriteTime -Descending | Select-Object -First 1
    if ($SessionId) { $log.Add('注意：没找到指定的会话，改用最近有改动的那一个。'); $log.Add('') }
  }

  if (-not $target) {
    $log.Add('**没找到会话文件。**')
    $problems.Add('没找到会话文件')
  } else {
    $base  = $Sessions.TrimEnd('\')
    $rel   = $target.FullName.Substring($base.Length).TrimStart('\')
    $parts = $rel -split '\\'
    $ws    = $parts[0]
    $sid   = $parts[1]

    $log.Add("会话：$sid")
    $log.Add('原始大小：' + [math]::Round($target.Length / 1KB) + ' KB')
    $log.Add('')

    foreach ($day in @($yesterday, $today)) {
      $dayDir   = Join-Path $Root $day
      $rawDest  = Join-Path $dayDir '原始'
      $chatDest = Join-Path $dayDir '聊天'
      $fullDest = Join-Path $dayDir '完整'
      $picDest  = Join-Path $dayDir '图片'
      New-Item -ItemType Directory -Force -Path $rawDest, $chatDest, $fullDest, $picDest | Out-Null

      # 原始文件：今天的快照放当天文件夹
      if ($day -eq $today) {
        $rawDir = Join-Path $rawDest $ws
        New-Item -ItemType Directory -Force -Path $rawDir | Out-Null
        Copy-Item $target.FullName (Join-Path $rawDir "$sid.zstd") -Force
      }

      # ── 聊天 txt：临时文件 → 校验 → 替换 ──
      $chatFile = Join-Path $chatDest "$day.txt"
      $tmpFile  = "$chatFile.tmp"
      Remove-Item $tmpFile -Force -ErrorAction SilentlyContinue

      $oldCount = 0
      if (Test-Path $chatFile) {
        $oldCount = (Select-String -Path $chatFile -Pattern '^\[\d{2}:\d{2}\] ' -Encoding UTF8 -AllMatches).Count
      }

      $out = & node $Exporter $target.FullName $tmpFile --txt --day $day --append `
               --attachments-dir $picDest --assistant-name $AssistantName --user-name $UserName 2>&1
      $code = $LASTEXITCODE
      $newCount = if ("$out" -match '(\d+) 条消息') { [int]$Matches[1] } else { 0 }

      if ($code -ne 0) {
        $problems.Add("$day 导出失败（exit $code）：" + ("$out" -replace '\s+', ' '))
        $log.Add("- $day：**导出失败**，原文件保留")
        Remove-Item $tmpFile -Force -ErrorAction SilentlyContinue
      } elseif ("$out" -match '没有消息') {
        $log.Add("- $day：这一天没有消息，跳过")
        Remove-Item $tmpFile -Force -ErrorAction SilentlyContinue
      } elseif (-not (Test-Path $tmpFile) -or (Get-Item $tmpFile).Length -lt 80) {
        $problems.Add("$day 导出的文件异常小")
        $log.Add("- $day：**导出文件异常**，原文件保留")
        Remove-Item $tmpFile -Force -ErrorAction SilentlyContinue
      } elseif ($newCount -lt $oldCount) {
        $problems.Add("$day 条数变少（$oldCount → $newCount），拒绝覆盖")
        $log.Add("- $day：**条数变少**（$oldCount → $newCount），拒绝覆盖")
        Remove-Item $tmpFile -Force -ErrorAction SilentlyContinue
      } else {
        Move-Item $tmpFile $chatFile -Force
        $log.Add("- $day：$newCount 条消息" + $(if ($newCount -gt $oldCount) { "（+$($newCount - $oldCount)）" } else { '' }))
      }

      # ── 完整版（带工具调用，追查用） ──
      $fullFile = Join-Path $fullDest ("{0}__{1}.md" -f $ws, $sid)
      $fullTmp  = "$fullFile.tmp"
      $out2 = & node $Exporter $target.FullName $fullTmp --day $day `
                --assistant-name $AssistantName --user-name $UserName 2>&1
      if ($LASTEXITCODE -eq 0 -and (Test-Path $fullTmp) -and (Get-Item $fullTmp).Length -gt 80) {
        Move-Item $fullTmp $fullFile -Force
      } else {
        Remove-Item $fullTmp -Force -ErrorAction SilentlyContinue
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
$logFile = Join-Path $logDir '备份记录.md'
Set-Content -Path $logFile -Value $log -Encoding UTF8

if ($problems.Count -gt 0) {
  Write-Host "备份完成，但有 $($problems.Count) 处需要看：$logFile"
  exit 1
}
Write-Host "备份完成：$Root  （$($Now.ToString('yyyy-MM-dd HH:mm'))）"
exit 0
