#Requires -Version 5.1
<#
.SYNOPSIS
  提交前验证。任何一项不过，退出码非 0。

.DESCRIPTION
  检查项：
    · 脚本语法与 BOM —— PowerShell 5.1 的坑
    · mjs 语法 (node --check)
    · 导出器能认出两种格式并真的导出消息
    · 备份脚本两种格式各跑一遍到临时目录，产出齐全、无残留
    · 仓库里没有个人路径 / 私人会话 ID 泄漏
    · 没有零宽空格之类看不见的字符

  跑法：  .\verify.ps1
#>
[CmdletBinding()]
param()

$ErrorActionPreference = 'Continue'
$repo = $PSScriptRoot
$script:pass = 0
$script:fail = 0
$script:skip = 0
$script:fails = New-Object System.Collections.Generic.List[string]

function Test-Check {
  param([string]$Name, [scriptblock]$Body)
  try {
    $r = & $Body
    if ("$r" -like 'SKIP*') {
      $script:skip++
      Write-Host ("  ~  {0}  —— {1}" -f $Name, ($r -replace '^SKIP:?\s*', ''))
    } else {
      $script:pass++
      Write-Host ("  OK {0}  —— {1}" -f $Name, $r)
    }
  } catch {
    $script:fail++
    $script:fails.Add("$Name：$($_.Exception.Message)")
    Write-Host ("  X  {0}  —— {1}" -f $Name, $_.Exception.Message)
  }
}

Write-Host ''
Write-Host "验证：$repo"
Write-Host ''

# ── 1. PowerShell 脚本：语法 + BOM ──
Test-Check 'ps1 语法' {
  $bad = @()
  foreach ($f in Get-ChildItem $repo -Filter '*.ps1' -File) {
    $errs = $null; $toks = $null
    [void][System.Management.Automation.Language.Parser]::ParseFile($f.FullName, [ref]$toks, [ref]$errs)
    if (@($errs).Count -gt 0) { $bad += "$($f.Name): " + (@($errs)[0].Message) }
  }
  if ($bad) { throw ($bad -join '；') }
  '两个文件都没报错'
}

Test-Check 'ps1 带 BOM' {
  $bad = @()
  foreach ($f in Get-ChildItem $repo -Filter '*.ps1' -File) {
    $b = [IO.File]::ReadAllBytes($f.FullName)
    if (-not ($b.Length -ge 3 -and $b[0] -eq 0xEF -and $b[1] -eq 0xBB -and $b[2] -eq 0xBF)) { $bad += $f.Name }
  }
  if ($bad) { throw ("没有 BOM：" + ($bad -join ', ')) }
  '都有'
}

# ── 2. mjs 语法 ──
Test-Check 'mjs 语法' {
  if (-not (Get-Command node -ErrorAction SilentlyContinue)) { return 'SKIP: 没装 node' }
  $files = @(Get-ChildItem $repo -Filter '*.mjs' -File) + @(Get-ChildItem (Join-Path $repo 'sources') -Filter '*.mjs' -File -ErrorAction SilentlyContinue)
  $bad = @()
  foreach ($f in $files) {
    & node --check $f.FullName 2>&1 | Out-Null
    if ($LASTEXITCODE -ne 0) { $bad += $f.Name }
  }
  if ($bad) { throw ("语法错误：" + ($bad -join ', ')) }
  "$($files.Count) 个文件通过"
}

# ── 3. 找真实会话文件（没装对应 agent 就跳过） ──
$dshFile = $null
$codexFile = $null
$dshRoot = Join-Path $HOME '.dsh\sessions'
$codexRoot = Join-Path $HOME '.codex\sessions'
if (Test-Path $dshRoot) {
  $dshFile = Get-ChildItem $dshRoot -Recurse -File -Filter 'session.v4.jsonl.zstd' -ErrorAction SilentlyContinue |
    Sort-Object LastWriteTime -Descending | Select-Object -First 1
}
if (Test-Path $codexRoot) {
  $codexFile = Get-ChildItem $codexRoot -Recurse -File -Filter 'rollout-*.jsonl' -ErrorAction SilentlyContinue |
    Sort-Object LastWriteTime -Descending | Select-Object -First 1
}

$exporter = Join-Path $repo 'export-session.mjs'
$backup = Join-Path $repo 'backup-chat.ps1'
$work = Join-Path ([IO.Path]::GetTempPath()) ('verify-' + [guid]::NewGuid().ToString('N').Substring(0, 8))
New-Item -ItemType Directory -Force -Path $work | Out-Null

try {
  # ── 4. 导出器：dsh ──
  Test-Check '导出自检 dsh' {
    if (-not $dshFile) { return 'SKIP: 这台机器上没有 DSH 会话' }
    $out = Join-Path $work 'dsh.txt'
    & node $exporter $dshFile.FullName $out --txt 2>&1 | Out-Null
    if ($LASTEXITCODE -ne 0) { throw "导出失败 exit $LASTEXITCODE" }
    $len = (Get-Item $out).Length
    if ($len -lt 200) { throw "文件太小（$len 字节）" }
    $n = @(Select-String -Path $out -Pattern '^\[[^\]]+\] ' -Encoding UTF8 -AllMatches).Count
    if ($n -lt 1) { throw '一条消息都没出来' }
    "$n 条消息，$([math]::Round($len/1KB)) KB"
  }

  # ── 5. 导出器：codex ──
  Test-Check '导出自检 codex' {
    if (-not $codexFile) { return 'SKIP: 这台机器上没有 Codex 会话' }
    $out = Join-Path $work 'codex.txt'
    & node $exporter $codexFile.FullName $out --txt --format codex 2>&1 | Out-Null
    if ($LASTEXITCODE -ne 0) { throw "导出失败 exit $LASTEXITCODE" }
    $n = @(Select-String -Path $out -Pattern '^\[[^\]]+\] ' -Encoding UTF8 -AllMatches).Count
    if ($n -lt 1) { throw '一条消息都没出来' }
    "$n 条消息"
  }

  # ── 6. 自动识别不许认错 ──
  Test-Check '自动识别' {
    if (-not $dshFile) { return 'SKIP: 没有样本' }
    $md = Join-Path $work 'auto.md'
    & node $exporter $dshFile.FullName $md 2>&1 | Out-Null
    if ($LASTEXITCODE -ne 0) { throw '自动识别失败' }
    $head = Get-Content $md -Encoding UTF8 -TotalCount 8
    if (-not ($head -match '格式：`dsh`')) { throw '自动识别认成了别的格式' }
    if ($codexFile) {
      & node $exporter $codexFile.FullName (Join-Path $work 'auto2.md') 2>&1 | Out-Null
      if ($LASTEXITCODE -ne 0) { throw 'codex 自动识别失败' }
    }
    '两种都对'
  }

  # ── 7. 识别不了的文件要拒 ──
  Test-Check '垃圾输入要拒绝' {
    $junk = Join-Path $work 'junk.bin'
    Set-Content -Path $junk -Value 'not a session' -Encoding UTF8
    & node $exporter $junk (Join-Path $work 'junk.txt') 2>&1 | Out-Null
    if ($LASTEXITCODE -ne 4) { throw "期望 exit 4，实际 $LASTEXITCODE" }
    'exit 4'
  }

  # ── 7b. 日期参数要严 ──
  Test-Check '空日期不写文件' {
    if (-not $dshFile) { return 'SKIP: 没有样本' }
    $out = Join-Path $work 'empty.txt'
    & node $exporter $dshFile.FullName $out --txt --day '1999-01-01' 2>&1 | Out-Null
    if ($LASTEXITCODE -ne 0) { throw "exit $LASTEXITCODE" }
    if (Test-Path $out) { throw '没有消息的日期居然写出了文件' }
    '不写'
  }

  Test-Check '假日期要拒绝' {
    if (-not $dshFile) { return 'SKIP: 没有样本' }
    & node $exporter $dshFile.FullName (Join-Path $work 'x.txt') --txt --day '2026-13-99' 2>&1 | Out-Null
    if ($LASTEXITCODE -ne 2) { throw "期望 exit 2，实际 $LASTEXITCODE" }
    'exit 2'
  }

  # ── 7c. 钩子得真的挂上 ──
  Test-Check '钩子挂好了' {
    $rel = '.githooks/pre-push'
    if (-not (Test-Path (Join-Path $repo $rel))) { throw '缺 .githooks/pre-push' }
    $mode = "$(git -C $repo ls-files -s $rel 2>$null)"
    if ($mode -notmatch '^100755') { throw '钩子没有可执行位，重新 git add 一次' }
    $cfg = "$(git -C $repo config --local core.hooksPath 2>$null)"
    if ($cfg -ne '.githooks') { return 'SKIP: 这台机器没设 core.hooksPath，push 时不会自动验证' }
    '已启用'
  }

  # ── 7c2. DSH 插件 ──
  Test-Check '插件文件' {
    $dir = Join-Path $repo 'plugin'
    if (-not (Test-Path $dir)) { return 'SKIP: 没有 plugin/ 目录' }
    $js = @(Get-ChildItem (Join-Path $dir 'lib') -Filter '*.js' -File -ErrorAction SilentlyContinue)
    if ($js.Count -lt 2) { throw "plugin/lib 里只有 $($js.Count) 个 js 文件" }
    foreach ($f in $js) {
      & node --check $f.FullName 2>&1 | Out-Null
      if ($LASTEXITCODE -ne 0) { throw "$($f.Name) 语法错误" }
    }
    $pkg = Get-Content (Join-Path $dir 'package.json') -Raw -Encoding UTF8 | ConvertFrom-Json
    if (-not $pkg.dsh.client) { throw 'package.json 缺 dsh.client' }
    if (-not $pkg.dsh.bundle) { throw 'package.json 缺 dsh.bundle' }
    if (-not (Test-Path (Join-Path $dir 'cordis.patch.yml'))) { throw '缺 cordis.patch.yml' }
    "$($js.Count) 个文件通过"
  }

  # ── 7d. 界面服务 ──
  Test-Check '界面服务能起来' {
    if (-not (Test-Path (Join-Path $repo 'ui/index.html'))) { throw '缺 ui/index.html' }
    $port = 7700 + (Get-Random -Maximum 200)
    $env:PORT = $port
    $proc = Start-Process node -ArgumentList (Join-Path $repo 'server.mjs') -PassThru -WindowStyle Hidden
    try {
      $st = $null
      for ($i = 0; $i -lt 40; $i++) {
        Start-Sleep -Milliseconds 250
        try {
          $st = Invoke-RestMethod "http://127.0.0.1:$port/api/state" -TimeoutSec 2
          break
        } catch {
          # 还没起来，接着等
        }
      }
      if (-not $st) { throw '10 秒内没起来' }
      if (-not $st.config.sources.dsh) { throw '/api/state 少了 config.sources.dsh' }
      if ($null -eq $st.dsh.workspaces) { throw '/api/state 少了工作区列表' }
      "端口 $port，工作区 $(@($st.dsh.workspaces).Count) 个"
    } finally {
      Stop-Process -Id $proc.Id -Force -ErrorAction SilentlyContinue
      Remove-Item Env:\PORT -ErrorAction SilentlyContinue
    }
  }

  # ── 8. 备份冒烟：dsh ──
  Test-Check '备份冒烟 dsh' {
    if (-not $dshFile) { return 'SKIP: 没有样本' }
    $root = Join-Path $work 'bk-dsh'
    & $backup -Root $root -Now (Get-Date) -AssistantName '验收' *> $null
    $code = $LASTEXITCODE
    if ($code -ne 0) { throw "退出码 $code，看 $(Join-Path $root '备份记录.md')" }
    $todayChat = Get-ChildItem $root -Recurse -Filter '*.txt' -ErrorAction SilentlyContinue | Select-Object -First 1
    if (-not $todayChat) { throw '没有产出聊天文件' }
    $n = @(Select-String -Path $todayChat.FullName -Pattern '^\[[^\]]+\] ' -Encoding UTF8 -AllMatches).Count
    if ($n -lt 1) { throw '聊天文件里没消息' }
    $residue = @(Get-ChildItem $root -Recurse -Include '*.tmp', '.lock' -ErrorAction SilentlyContinue)
    if ($residue.Count -gt 0) { throw ("残留：" + ($residue.Name -join ', ')) }
    "$n 条消息，无残留"
  }

  # ── 9. 备份冒烟：codex ──
  Test-Check '备份冒烟 codex' {
    if (-not $codexFile) { return 'SKIP: 没有样本' }
    $root = Join-Path $work 'bk-codex'
    # 用样本自己的日期当「今天」，否则会捞不到
    $mt = $codexFile.LastWriteTime
    & $backup -Format codex -Root $root -Now $mt -AssistantName '验收' *> $null
    $code = $LASTEXITCODE
    if ($code -ne 0) { throw "退出码 $code" }
    $anyTxt = Get-ChildItem $root -Recurse -Filter '*.txt' -ErrorAction SilentlyContinue | Select-Object -First 1
    if (-not $anyTxt) { throw '没有产出聊天文件' }
    $n = @(Select-String -Path $anyTxt.FullName -Pattern '^\[[^\]]+\] ' -Encoding UTF8 -AllMatches).Count
    if ($n -lt 1) { throw '聊天文件里没消息' }
    "$n 条消息"
  }

  # ── 10. 别把私人路径推上去 ──
  Test-Check '没有私人信息' {
    $patterns = @(
      ('黄' + '同学'),
      ('芙' + '莉莲'),
      ('be8b' + 'd838'),
      # 只认路径那种写法；插件包里的 npm 关键词 deepseek-harness 是正常的
      ('Documents\' + 'deepseek-harness')
    )
    $hit = @()
    foreach ($rel in @(git -C $repo ls-files)) {
      if ($rel -notmatch '\.(md|mjs|ps1|json|yml|yaml|txt)$') { continue }
      $full = Join-Path $repo $rel
      if (-not (Test-Path $full)) { continue }
      $text = [IO.File]::ReadAllText($full, [Text.UTF8Encoding]::new($false))
      foreach ($p in $patterns) {
        if ($text.Contains($p)) { $hit += "$rel（$($p.Substring(0,2))…）" }
      }
    }
    if ($hit) { throw ("发现：" + ($hit -join '，')) }
    "$($patterns.Count) 种模式，无命中"
  }

  # ── 11. 看不见的字符 ──
  Test-Check '没有零宽字符' {
    $hit = @()
    foreach ($rel in @(git -C $repo ls-files)) {
      if ($rel -notmatch '\.(md|mjs|ps1|json|yml|yaml|txt)$') { continue }
      $full = Join-Path $repo $rel
      if (-not (Test-Path $full)) { continue }
      $text = [IO.File]::ReadAllText($full, [Text.UTF8Encoding]::new($false))
      foreach ($ch in @([char]0x200B, [char]0x200C, [char]0x200D, [char]0xFEFF)) {
        if ($text.Contains([string]$ch)) { $hit += $rel }
      }
    }
    if ($hit) { throw ("含零宽字符：" + (($hit | Select-Object -Unique) -join '，')) }
    '干净'
  }
}
finally {
  Remove-Item $work -Recurse -Force -ErrorAction SilentlyContinue
}

Write-Host ''
if ($script:fail -gt 0) {
  Write-Host ("没通过：{0} 项失败，{1} 项通过，{2} 项跳过" -f $script:fail, $script:pass, $script:skip)
  foreach ($f in $script:fails) { Write-Host ("  - " + $f) }
  exit 1
}
Write-Host ("通过：{0} 项，跳过 {1} 项" -f $script:pass, $script:skip)
exit 0
