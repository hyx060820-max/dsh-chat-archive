#Requires -Version 5.1
<#
.SYNOPSIS
  把「记忆体」装进 DSH 的 desktop profile。

.DESCRIPTION
  做三件事：
    · 备份 profile 的 package.json
    · 把插件文件复制到 <profile>\node_modules\dsh-memory
    · 在 package.json 里补一行依赖和一条 bundle

  装完要重启 DSH 才生效。设置页左侧会出现「记忆体」。

  撤销：.\install.ps1 -Uninstall

  注意：本文件必须保存为 UTF-8 with BOM。
#>
[CmdletBinding()]
param([switch]$Uninstall)

$profileDir = Join-Path $HOME '.dsh\profiles\desktop'
$src = $PSScriptRoot
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

New-Item -ItemType Directory -Force -Path $dst | Out-Null
Copy-Item (Join-Path $src 'lib') $dst -Recurse -Force
foreach ($f in @('package.json', 'cordis.patch.yml')) {
  Copy-Item (Join-Path $src $f) $dst -Force
}
Write-Host "已复制插件 → $dst"

$pkg = Get-Content $pkgPath -Raw -Encoding UTF8 | ConvertFrom-Json

$spec = 'file:' + ($src -replace '\\', '/')
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
Write-Host '要撤销：.\install.ps1 -Uninstall'
