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
  $files = @(Get-ChildItem $repo -Filter '*.mjs' -File) + @(Get-ChildItem (Join-Path $repo 'sources') -Filter '*.mjs' -File -ErrorAction SilentlyContinue) + @(Get-ChildItem (Join-Path $repo 'tools') -Filter '*.mjs' -File -ErrorAction SilentlyContinue)
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

  # ── 5b. 导出器：workbuddy ──
  Test-Check '导出自检 workbuddy' {
    $wbRoot = Join-Path $HOME '.workbuddy\projects'
    if (-not (Test-Path $wbRoot)) { return 'SKIP: 这台机器上没有 WorkBuddy' }
    $wbFile = Get-ChildItem $wbRoot -Recurse -File -Filter '*.jsonl' -ErrorAction SilentlyContinue |
      Where-Object { $_.Name -notlike '*rollback*' } |
      Sort-Object Length -Descending | Select-Object -First 1
    if (-not $wbFile) { return 'SKIP: 没有 WorkBuddy 会话' }
    $out = Join-Path $work 'wb.txt'
    & node $exporter $wbFile.FullName $out --txt --format workbuddy 2>&1 | Out-Null
    if ($LASTEXITCODE -ne 0) { throw "导出失败 exit $LASTEXITCODE" }
    $n = @(Select-String -Path $out -Pattern '^\[[^\]]+\] ' -Encoding UTF8 -AllMatches).Count
    if ($n -lt 1) { throw '一条消息都没出来' }
    $junk = @(Select-String -Path $out -Pattern 'system-reminder' -AllMatches).Count
    if ($junk -gt 0) { throw "有 $junk 处 system-reminder 没剥干净" }
    "$n 条消息，注入块已剥掉"
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
    if (-not $pkg.dsh.client) { throw 'plugin/package.json 缺 dsh.client' }
    if (-not $pkg.dsh.bundle) { throw 'plugin/package.json 缺 dsh.bundle' }
    if (-not (Test-Path (Join-Path $dir 'cordis.patch.yml'))) { throw '缺 plugin/cordis.patch.yml' }

    # 根目录也得是能装的插件包，否则在 DSH 的插件页里填仓库地址会报
    # 「这个包没有声明组合包」
    $rootPkg = Join-Path $repo 'package.json'
    if (-not (Test-Path $rootPkg)) { throw '根目录缺 package.json（插件页按仓库装会失败）' }
    $rp = Get-Content $rootPkg -Raw -Encoding UTF8 | ConvertFrom-Json
    if (-not $rp.dsh.bundle) { throw '根 package.json 缺 dsh.bundle' }
    if (-not $rp.dsh.client) { throw '根 package.json 缺 dsh.client' }
    if ($rp.name -ne 'dsh-memory') { throw "根 package.json 的 name 是 $($rp.name)，必须是 dsh-memory（要和 cordis 里的名字对上）" }
    $patch = Join-Path $repo ($rp.dsh.bundle.patch -replace '^\./', '')
    if (-not (Test-Path $patch)) { throw "根 package.json 指向的 patch 不存在：$($rp.dsh.bundle.patch)" }

    "$($js.Count) 个文件通过，根包也能装"
  }

  # ── 7c2a. 装出来的包布局要和入口对得上 ──
  Test-Check '包布局' {
    $tmp = Join-Path $work 'pkg'
    New-Item -ItemType Directory -Force -Path $tmp | Out-Null
    Copy-Item (Join-Path $repo 'package.json') $tmp -Force
    Copy-Item (Join-Path $repo 'plugin') (Join-Path $tmp 'plugin') -Recurse -Force
    Copy-Item (Join-Path $repo 'backup-chat.ps1') $tmp -Force

    $rp = Get-Content (Join-Path $tmp 'package.json') -Raw -Encoding UTF8 | ConvertFrom-Json
    $main = $rp.main -replace '^\./', ''
    if (-not (Test-Path (Join-Path $tmp $main))) {
      throw "根 package.json 的 main 是 $($rp.main)，但这个路径在包布局里不存在"
    }
    $client = $rp.exports.'./client'.default -replace '^\./', ''
    if (-not (Test-Path (Join-Path $tmp $client))) {
      throw "exports 的 ./client 指向 $($rp.exports.'./client'.default)，文件不存在"
    }
    $patch = $rp.dsh.bundle.patch -replace '^\./', ''
    if (-not (Test-Path (Join-Path $tmp $patch))) {
      throw "bundle.patch 指向 $($rp.dsh.bundle.patch)，文件不存在"
    }
    'main / client / patch 都对得上'
  }

  # ── 7c2b. 设置面板的 hooks 顺序 ──
  Test-Check '面板钩子顺序' {
    $c = Get-Content (Join-Path $repo 'plugin/lib/client.js') -Raw -Encoding UTF8
    # 只看 MemoryPanel 那段（ReadButton 是另一个组件，它的钩子在后面是正常的）
    $from = $c.IndexOf('function MemoryPanel')
    $to = $c.IndexOf('function useBtnShow')
    if ($from -lt 0 -or $to -lt 0 -or $to -le $from) { throw '面板边界找不到，检查逻辑要改' }
    $panel = $c.Substring($from, $to - $from)
    $guard = $panel.IndexOf('if (!st) return')
    if ($guard -lt 0) { throw '没找到面板的提前返回，检查逻辑要改' }
    $lastHook = $panel.LastIndexOf('react.useState')
    if ($lastHook -gt $guard) {
      $line = ($panel.Substring(0, $lastHook) -split "`n").Count
      throw "第 $line 行有 useState 在提前返回之后。React 的钩子规则一破，整个面板会变空白"
    }
    '钩子都在提前返回之前'
  }

  # ── 7c3. 技能版 ──
  Test-Check '记忆体 CLI' {
    & node (Join-Path $repo 'tools/memory.mjs') 2>&1 | Out-Null
    if ($LASTEXITCODE -ne 2) { throw "不带参数应该 exit 2，实际 $LASTEXITCODE" }
    $sk = Join-Path $repo 'plugin-skill\SKILL.md'
    if (-not (Test-Path $sk)) { throw '缺 plugin-skill/SKILL.md' }
    $head = (Get-Content $sk -Encoding UTF8 -TotalCount 1)
    if ("$head".Trim() -ne '---') { throw 'SKILL.md 缺 frontmatter' }
    if (-not (Get-Content $sk -Raw -Encoding UTF8).Contains('{{REPO}}')) { throw 'SKILL.md 里没有 {{REPO}} 占位，装的时候就没法替换' }

    # 关于我：建、加、删，三步都要真的动文件
    $mr = Join-Path $work 'me-root'
    $cli = Join-Path $repo 'tools/memory.mjs'
    & node $cli me add '验收一条' --root $mr 2>&1 | Out-Null
    if ($LASTEXITCODE -ne 0) { throw "me add 失败 exit $LASTEXITCODE" }
    $meFile = Join-Path $mr '关于我.md'
    if (-not (Test-Path $meFile)) { throw 'me add 没建出 关于我.md' }
    if (-not (Get-Content $meFile -Raw -Encoding UTF8).Contains('验收一条')) { throw 'me add 的内容没写进去' }
    & node $cli me forget 验收 --root $mr 2>&1 | Out-Null
    if ((Get-Content $meFile -Raw -Encoding UTF8).Contains('验收一条')) { throw 'me forget 没删掉' }

    'usage、占位符、关于我 读写都在'
  }

  # ── 7d. 界面服务 ──
  Test-Check '界面服务能起来' {
    if (-not (Test-Path (Join-Path $repo 'ui/index.html'))) { throw '缺 ui/index.html' }
    $st = $null
    $port = 0
    $why = ''
    # 端口可能被占。换三个都起不来才算失败，并把 node 的输出带上
    foreach ($try in 1..3) {
      $port = 7900 + (Get-Random -Maximum 400)
      $env:PORT = "$port"
      $outF = Join-Path $work "srv$try.log"
      $errF = "$outF.err"
      $proc = Start-Process node -ArgumentList (Join-Path $repo 'server.mjs') -PassThru `
        -NoNewWindow -RedirectStandardOutput $outF -RedirectStandardError $errF
      try {
        for ($i = 0; $i -lt 30; $i++) {
          Start-Sleep -Milliseconds 250
          if ($proc.HasExited) { break }
          try {
            $st = Invoke-RestMethod "http://127.0.0.1:$port/api/state" -TimeoutSec 2
            break
          } catch {
            # 还没起来，接着等
          }
        }
      } finally {
        if ($proc -and -not $proc.HasExited) { Stop-Process -Id $proc.Id -Force -ErrorAction SilentlyContinue }
      }
      if ($st) { break }
      $why = (((Get-Content $errF -Raw -ErrorAction SilentlyContinue) + (Get-Content $outF -Raw -ErrorAction SilentlyContinue)) + '').Trim()
    }
    Remove-Item Env:\PORT -ErrorAction SilentlyContinue
    if (-not $st) { throw ("三个端口都没起来。" + $why) }
    if (-not $st.config.sources.dsh) { throw '/api/state 少了 config.sources.dsh' }
    if ($null -eq $st.dsh.workspaces) { throw '/api/state 少了工作区列表' }
    "端口 $port，工作区 $(@($st.dsh.workspaces).Count) 个"
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
