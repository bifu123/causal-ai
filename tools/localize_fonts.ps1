# =============================================================================
#  前端字体本地化脚本
#  将页面原先从 https://fonts.googleapis.com 加载的 Orbitron / Noto Sans SC
#  转为项目内自托管（static/fonts），生成 static/css/fonts.local.css。
#
#  为什么不用 fonts.gstatic.cn 的切片清单：
#    该域名在本网络环境不可达；而 fonts.googleapis.cn 返回的清单里 Noto Sans SC
#    会被裁成分散的大量小切片（300+ 个文件），逐个抓取既慢又易失败。
#  因此改从 @fontsource 包（经 jsdelivr 分发）取两个稳定子集：
#    - chinese-simplified（简体中文全量字形）
#    - latin（拉丁字母，Noto 中文正文里的英文/数字）
#  这样每个字重只需 2 个 woff2 文件，浏览器按需加载，且完全可离线。
#
#  用法：powershell -NoProfile -ExecutionPolicy Bypass -File localize_fonts.ps1
# =============================================================================
param(
    [string]$FontDir,
    [string]$OutCss
)
$ProgressPreference = 'SilentlyContinue'
# 默认路径基于仓库根目录（脚本位于 tools/ 下），避免依赖当前工作目录
$repoRoot = Split-Path -Parent $PSScriptRoot
if (-not $FontDir) { $FontDir = Join-Path $repoRoot 'static/fonts' }
if (-not $OutCss) { $OutCss = Join-Path $repoRoot 'static/css/fonts.local.css' }
New-Item -ItemType Directory -Force -Path $FontDir | Out-Null
New-Item -ItemType Directory -Force -Path (Split-Path $OutCss) | Out-Null
Write-Output "字体目录: $FontDir"
Write-Output "CSS 输出: $OutCss"

$orbitronVersion = '5.0.0'
$notoVersion = '5.0.0'
$orbitronWeights = @('400', '700', '900')
$notoWeights = @('300', '400', '500', '700', '900')

function Get-RemoteFile {
    param([string]$Url, [string]$Dest)
    if ((Test-Path $Dest) -and (Get-Item $Dest).Length -gt 1024) { return $true }
    $tmp = "$Dest.part"
    try {
        Invoke-WebRequest -Uri $Url -OutFile $tmp -UseBasicParsing -TimeoutSec 300
        Move-Item -LiteralPath $tmp -Destination $Dest -Force
        return $true
    } catch {
        Write-Output "下载失败: $Url -> $($_.Exception.Message)"
        if (Test-Path $tmp) { Remove-Item -LiteralPath $tmp -Force }
        return $false
    }
}

$jsdelivr = 'https://cdn.jsdelivr.net/npm'
$npmmirror = 'https://registry.npmmirror.com'

# ---------- 1. Orbitron：仅 latin，3 个字重 ----------
foreach ($w in $orbitronWeights) {
    $name = "Orbitron-$w.woff2"
    $dest = Join-Path $FontDir $name
    $ok = Get-RemoteFile "$jsdelivr/@fontsource/orbitron@$orbitronVersion/files/orbitron-latin-$w-normal.woff2" $dest
    if (-not $ok) {
        Get-RemoteFile "$npmmirror/@fontsource/orbitron/$orbitronVersion/files/orbitron-latin-$w-normal.woff2" $dest | Out-Null
    }
}

# ---------- 2. Noto Sans SC：chinese-simplified + latin，3 个字重 ----------
$notoOk = @{}
foreach ($w in $notoWeights) {
    $notoOk[$w] = @{}
    foreach ($subset in @('chinese-simplified', 'latin')) {
        $name = "NotoSansSC-$w-$subset.woff2"
        $dest = Join-Path $FontDir $name
        $ok = Get-RemoteFile "$jsdelivr/@fontsource/noto-sans-sc@$notoVersion/files/noto-sans-sc-$subset-$w-normal.woff2" $dest
        if (-not $ok) {
            $ok = Get-RemoteFile "$npmmirror/@fontsource/noto-sans-sc/$notoVersion/files/noto-sans-sc-$subset-$w-normal.woff2" $dest
        }
        $notoOk[$w][$subset] = $ok
    }
}

# ---------- 3. 生成 @font-face 样式 ----------
$orbitronRange = 'U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0300-0301,U+0303-0304,U+0308-0309,U+0323,U+0329,U+2000-206F,U+2074,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD'

$lines = New-Object System.Collections.Generic.List[string]
$lines.Add('/* ==========================================================================')
$lines.Add(' * 本地化字体样式（自动生成，勿手改）：')
$lines.Add(' *   生成脚本 tools/localize_fonts.ps1（npm run fonts）')
$lines.Add(' * 原先页面通过 <link href="https://fonts.googleapis.com/css2?..."> 加载字体，')
$lines.Add(' * 现改为读取 /static/fonts 下的自托管 woff2，内网 / 无外网环境同样可用。')
$lines.Add(' *   - Orbitron 400/700/900：latin 子集')
$lines.Add(' *   - Noto Sans SC 300/400/500/700/900：chinese-simplified + latin 子集')
$lines.Add(' * font-family 名称与 Google Fonts 完全一致，页面样式无需改动。')
$lines.Add(' * ========================================================================== */')
$lines.Add('')
$lines.Add('/* Orbitron（标题 / 数字科技字体） */')
foreach ($w in $orbitronWeights) {
    $file = Join-Path $FontDir "Orbitron-$w.woff2"
    if (-not (Test-Path $file)) { Write-Output "缺少 Orbitron-$w.woff2，跳过"; continue }
    $lines.Add('@font-face {')
    $lines.Add("  font-family: 'Orbitron';")
    $lines.Add('  font-style: normal;')
    $lines.Add("  font-weight: $w;")
    $lines.Add('  font-display: swap;')
    $lines.Add("  src: url('/static/fonts/Orbitron-$w.woff2') format('woff2');")
    $lines.Add("  unicode-range: $orbitronRange;")
    $lines.Add('}')
}
$lines.Add('')
$lines.Add('/* Noto Sans SC（中文正文字体）：latin 在前优先匹配英文与数字，')
$lines.Add(' * 未命中的 CJK 字符由 chinese-simplified 分片接管 */')
foreach ($w in $notoWeights) {
    foreach ($subset in @('latin', 'chinese-simplified')) {
        if (-not $notoOk[$w][$subset]) { continue }
        $lines.Add('@font-face {')
        $lines.Add("  font-family: 'Noto Sans SC';")
        $lines.Add('  font-style: normal;')
        $lines.Add("  font-weight: $w;")
        $lines.Add('  font-display: swap;')
        $lines.Add("  src: url('/static/fonts/NotoSansSC-$w-$subset.woff2') format('woff2');")
        if ($subset -eq 'latin') {
            $lines.Add("  unicode-range: $orbitronRange;")
        }
        $lines.Add('}')
    }
}
Set-Content -LiteralPath $OutCss -Value $lines -Encoding UTF8

$total = Get-ChildItem -LiteralPath $FontDir -File | Measure-Object Length -Sum
Write-Output ("CSS 已生成: {0}；字体文件 {1} 个，共 {2:N0} KB" -f $OutCss, $total.Count, [math]::Round($total.Sum / 1KB))


