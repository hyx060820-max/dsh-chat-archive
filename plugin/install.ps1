#Requires -Version 5.1
<#
.SYNOPSIS
  把「记忆体」装进 DSH 的 desktop profile。

.DESCRIPTION
  做三件事：
    · 备份 profile 的 package.json
    · 把插件连同备份脚本一起复制到 <profile>\node_modules\dsh-memory
    · 在 package.json 里补一行依赖和一条 bundle

  装出来的包和从 Git 装的一样：根 package.json + plugin/ 子目录 + 脚本。
  根 package.json 的 main 是 ./plugin/lib/index.js，所以 plugin 目录必须原样保留。

  装完要重启 DSH 才生效。设置页左侧会出现「记忆体」。
  「脚本目录」可以留空——脚本已经跟着包走了。

  撤销：.\install.ps1 -Uninstall

  注意：本文件必须保存为 UTF-8 with BOM。
#>
[CmdletBinding()]
param([switch]$Uninstall)

$profileDir = Join-Path $HOME '.dsh\profiles\desktop'
$src = $PSScriptRoot
$repoRoot = Split-Path $src -Parent
$dst = Join-Path $profileDir 'node_modules\dsh-memory'
$pkgPath = Join-Path $profileDir 'package.json'
$bakPath = "$pkgPath.dsh-memory.bak"
$bundleName = 'dsh-memory'

if (-not (Test-Path $pkgPath)) {
  Write-Host "找不到 profile：$pkgPath"
  exit 2
}

if ($Uninstall) {
  if (Test-Path $dst) {
    Remove-Item $dst -Recurse -Force
    Write-Host "已删除 $dst"
  }
  if (Test-Path $bakPath) {
    Copy-Item $bakPath $pkgPath -Force
    Write-Host 'package.json 已还原'
  }
  Write-Host '卸载完成，重启 DSH 生效。'
  exit 0
}

if (-not (Test-Path $bakPath)) {
  Copy-Item $pkgPath $bakPath
  Write-Host "已备份 package.json → $bakPath"
}

$rootPkg = Join-Path $repoRoot 'package.json'
if (-not (Test-Path $rootPkg)) {
  Write-Host "根目录没有 package.json，装不了：$rootPkg"
  exit 2
}

if (Test-Path $dst) { Remove-Item $dst -Recurse -Force }
New-Item -ItemType Directory -Force -Path $dst | Out-Null

# 包身份 + 插件目录（保留 plugin/ 这一层，入口才找得到）
Copy-Item $rootPkg $dst -Force
Copy-Item $src (Join-Path $dst 'plugin') -Recurse -Force

# 备份脚本：跟着包走，「脚本目录」就能留空
foreach ($f in @('backup-chat.ps1', 'export-session.mjs', 'LICENSE')) {
  $p = Join-Path $repoRoot $f
  if (Test-Path $p) { Copy-Item $p $dst -Force }
}
foreach ($dirName in @('sources', 'tools')) {
  $p = Join-Path $repoRoot $dirName
  if (Test-Path $p) { Copy-Item $p $dst -Recurse -Force }
}

# 复制完先自查，别等重启才发现插件起不来
$entry = Join-Path $dst 'plugin\lib\index.js'
if (-not (Test-Path $entry)) {
  Write-Host "装出来的包缺入口：$entry"
  Write-Host '（根 package.json 的 main 指向 ./plugin/lib/index.js）'
  exit 2
}
if (-not (Test-Path (Join-Path $dst 'backup-chat.ps1'))) {
  Write-Host '装出来的包缺 backup-chat.ps1'
  exit 2
}

$copied = @(Get-ChildItem $dst -Force | ForEach-Object { $_.Name }) -join ', '
Write-Host "已复制插件 + 脚本 → $dst"
Write-Host "  内含：$copied"

$pkg = Get-Content $pkgPath -Raw -Encoding UTF8 | ConvertFrom-Json

$spec = 'file:' + ($repoRoot -replace '\\', '/')
if ($pkg.dependencies.PSObject.Properties.Name -contains $bundleName) {
  $pkg.dependencies.$bundleName = $spec
} else {
  $pkg.dependencies | Add-Member -NotePropertyName $bundleName -NotePropertyValue $spec
}

$bundles = @($pkg.dsh.profile.bundles)
if ($bundles -notcontains $bundleName) { $bundles += $bundleName }
$pkg.dsh.profile.bundles = $bundles

$json = $pkg | ConvertTo-Json -Depth 30
[IO.File]::WriteAllText($pkgPath, $json + "`n", [Text.UTF8Encoding]::new($false))
Write-Host "已登记到 package.json（依赖 + bundle）"

Write-Host ''
Write-Host '重启 DSH，设置里就会出现「记忆体」。'
Write-Host '「脚本目录」可以留空——脚本已经跟插件一起装好了。'
Write-Host '要撤销：.\install.ps1 -Uninstall'
