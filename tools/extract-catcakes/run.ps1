# 猫猫糕模型提取脚本（AnimeStudio CLI + FBX2glTF 一条龙）
# 用法：双击 run.bat，或 powershell -ExecutionPolicy Bypass -File run.ps1 [-Auto]
param(
    [switch]$Auto  # 全自动模式：不暂停让人工检查 filters.txt
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$work = Join-Path $root 'work'
$out  = Join-Path $root 'output'
$null = New-Item -ItemType Directory -Force $work, $out

function Log([string]$msg)  { Write-Host "[猫猫糕] $msg" -ForegroundColor Cyan }
function Warn([string]$msg) { Write-Host "[猫猫糕] $msg" -ForegroundColor Yellow }
function Fail([string]$msg) { Write-Host "[猫猫糕] $msg" -ForegroundColor Red; exit 1 }

# ============ 1. 定位游戏资产目录 ============
Log '第 1/6 步：定位崩铁游戏资产目录…'
$guesses = @(
    'C:\Program Files\Star Rail\Game\StarRail_Data\StreamingAssets\Asb\Windows',
    'D:\Program Files\Star Rail\Game\StarRail_Data\StreamingAssets\Asb\Windows',
    'D:\Star Rail\Game\StarRail_Data\StreamingAssets\Asb\Windows',
    'E:\Star Rail\Game\StarRail_Data\StreamingAssets\Asb\Windows',
    "$env:ProgramFiles\Star Rail\Game\StarRail_Data\StreamingAssets\Asb\Windows"
)
$asb = $null
foreach ($g in $guesses) { if (Test-Path $g) { $asb = $g; break } }
while ($true) {
    if (-not $asb) {
        Write-Host '没找到默认目录，请手动输入（形如 ...\StarRail_Data\StreamingAssets\Asb\Windows）：' -NoNewline
        $asb = Read-Host
    }
    if ((Test-Path $asb) -and (Get-ChildItem $asb -Filter *.block -ErrorAction SilentlyContinue | Select-Object -First 1)) { break }
    Warn "目录无效或里面没有 .block 文件：$asb"
    $asb = $null
}
Log "资产目录：$asb"

# ============ 2. 准备工具 ============
Log '第 2/6 步：准备工具（AnimeStudio / FBX2glTF / .NET 运行时）…'
$toolsDir = Join-Path $work 'tools'
$null = New-Item -ItemType Directory -Force $toolsDir

# 2a. AnimeStudio（nightly.link 拉取 CI 构建产物，含 CLI+GUI+FBX 原生库）
$asDir = Join-Path $toolsDir 'animestudio'
$cli = Get-ChildItem $asDir -Recurse -Filter AnimeStudio.CLI.exe -ErrorAction SilentlyContinue | Select-Object -First 1
if (-not $cli) {
    Log '下载 AnimeStudio（约 12MB）…'
    $zip = Join-Path $toolsDir 'animestudio.zip'
    Invoke-WebRequest 'https://nightly.link/Escartem/AnimeStudio/workflows/build/master/AnimeStudio-net9.zip' -OutFile $zip
    Expand-Archive $zip $asDir -Force
    Remove-Item $zip
    $cli = Get-ChildItem $asDir -Recurse -Filter AnimeStudio.CLI.exe | Select-Object -First 1
    if (-not $cli) { Fail '解压后没找到 AnimeStudio.CLI.exe，请把本脚本目录发回给作者排查。' }
}
Log "AnimeStudio CLI：$($cli.FullName)"

# 2b. .NET 9 运行时
$hasRt = $false
try {
    $rts = (& dotnet --list-runtimes 2>$null) | Out-String
    if ($rts -match 'Microsoft\.NETCore\.App 9\.') { $hasRt = $true }
} catch {}
if (-not $hasRt) {
    Warn '缺少 .NET 9 运行时，尝试用 winget 安装（可能会弹 UAC 确认框）…'
    try {
        & winget install --id Microsoft.DotNet.Runtime.9 -e --accept-source-agreements --accept-package-agreements
    } catch { Warn "winget 安装失败：$_" }
    $rts = (& dotnet --list-runtimes 2>$null) | Out-String
    if ($rts -notmatch 'Microsoft\.NETCore\.App 9\.') {
        Fail '还是没检测到 .NET 9 运行时。请手动安装：https://dotnet.microsoft.com/download/dotnet/9.0 （选 ".NET Runtime" x64）装完重跑本脚本。'
    }
}
Log '.NET 9 运行时 OK'

# 2c. FBX2glTF
$f2g = Get-ChildItem $toolsDir -Recurse -Filter 'FBX2glTF*.exe' -ErrorAction SilentlyContinue | Select-Object -First 1
if (-not $f2g) {
    Log '下载 FBX2glTF…'
    $zip = Join-Path $toolsDir 'fbx2gltf.zip'
    Invoke-WebRequest 'https://github.com/godotengine/FBX2glTF/releases/download/v0.13.1/FBX2glTF-windows-x86_64.zip' -OutFile $zip
    Expand-Archive $zip (Join-Path $toolsDir 'fbx2gltf') -Force
    Remove-Item $zip
    $f2g = Get-ChildItem $toolsDir -Recurse -Filter 'FBX2glTF*.exe' | Select-Object -First 1
    if (-not $f2g) { Fail '解压后没找到 FBX2glTF.exe。' }
}
Log "FBX2glTF：$($f2g.FullName)"

# ============ 3. 建立资产索引 ============
Log '第 3/6 步：扫描游戏资产建立索引（资产 15G+，可能要 10~30 分钟，请耐心等待）…'
# 用 XML 流式建索引（JSON 会把几百万条 AssetEntry 全量堆进内存导致 OOM；XML 走流式边扫边写盘）
# 产物落在「输出目录」下：<output>\sr_map.xml
$mapXml = Join-Path $work 'map\sr_map.xml'
if (-not (Test-Path $mapXml)) {
    Push-Location $work
    try {
        & $cli.FullName --game SR --map_op AssetMap --map_type XML --map_name sr_map --silent "$asb" "$work\map"
        if ($LASTEXITCODE -ne 0) { Fail "建索引失败（退出码 $LASTEXITCODE），请把上方报错截图发回。" }
    } finally { Pop-Location }
}
if (-not (Test-Path $mapXml)) {
    # 兜底：索引可能写到别的位置，全盘搜一下
    $found = Get-ChildItem $work -Recurse -Filter 'sr_map.xml' -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($found) { $mapXml = $found.FullName } else { Fail '跑完了但找不到 sr_map.xml，请把 work 目录结构截图发回。' }
}
Log "索引完成：$mapXml"

# ============ 4. 关键词侦查 ============
Log '第 4/6 步：按关键词筛选疑似猫猫糕资产…'
# 已实证：猫糕官方内部命名 RuanMadeCake（索引默认不解析 GameObject，看命中条目数，正常几百条）
$keywords = 'ruanmadecake'
# 流式逐行扫 XML（不整文件读入）：按 <Asset> 块累积 Name/Container/Type
$candFile = Join-Path $work 'candidates.txt'
$hitCount = 0
$cur = $null
$outLines = New-Object System.Collections.Generic.List[string]
switch -Regex -File $mapXml {
    '<Asset>'        { $cur = @{ Name=''; Container=''; Type='' }; continue }
    '</Asset>'       {
        if ($cur -and ($cur.Name -match $keywords -or $cur.Container -match $keywords)) {
            $outLines.Add("$($cur.Type)`t$($cur.Name)`t$($cur.Container)")
            $hitCount++
        }
        $cur = $null; continue
    }
    '^\s*<Name>(.*)</Name>'             { if ($cur) { $cur.Name = $Matches[1] }; continue }
    '^\s*<Container>(.*)</Container>'   { if ($cur) { $cur.Container = $Matches[1] }; continue }
    '^\s*<Type[^>]*>(.*)</Type>'        { if ($cur) { $cur.Type = $Matches[1] }; continue }
}
$outLines | Set-Content $candFile -Encoding UTF8
Log "命中 $hitCount 条（ruanmadecake 正常应有几百条），清单已写入 work\candidates.txt"
if ($hitCount -lt 50) {
    Warn '命中过少（0 条或很少说明筛选规则不对），建议把 work\candidates.txt 先发回给作者确认关键词。'
}

# ============ 5. 导出 FBX + 贴图 ============
Log '第 5/6 步：导出模型和贴图…'
$filters = Join-Path $work 'filters.txt'
if (-not (Test-Path $filters)) {
    # 默认规则：猫糕官方内部命名（注意别把 RuanMadeShaoMai 烧麦加进来）
    @('ruanmadecake') | Set-Content $filters -Encoding UTF8
}
if (-not $Auto) {
    Write-Host ''
    Write-Host '—— 筛选规则文件即将打开（work\filters.txt），每行一个正则，默认 ruanmadecake' -ForegroundColor Green
    Write-Host '—— 一般不用改。如果上一步提示命中偏少，可以照 candidates.txt 里的名字补充规则' -ForegroundColor Green
    Write-Host '—— 确认后直接关闭记事本，回到这里按回车继续' -ForegroundColor Green
    notepad $filters
    Read-Host '按回车开始导出'
}
Push-Location $work
try {
    # Load+AssetMap 才会走索引（只 Load 会重扫全量资产）；--map_name 传 XML 完整路径
    # 注意逗号要加引号，否则 PowerShell 会把 Load,AssetMap 拆成两个参数
    # --types 是 AllowMultipleArgumentsPerToken 会吞后面的位置参数，两个位置路径必须放最后
    # --names 的文件路径转成正斜杠（新版 System.CommandLine 会把反斜杠路径当正则误杀）
    $filtersFwd = $filters -replace '\\', '/'
    # 导出拆两条命令依次跑（同一 filters、同一 exportDir）：
    # --types 带 GameObject 时 Animator 会被强制只解析不导出（Program.cs: SetType(Animator, true, false)），
    # 动画烘不进 FBX，所以动画必须单独跑一条不带 GameObject 的命令
    Log '导出模型贴图（GameObject + Texture2D）…'
    & $cli.FullName --game SR --map_op "Load,AssetMap" --map_type XML --map_name "$mapXml" --types GameObject Texture2D --names "$filtersFwd" --group_assets ByContainer --silent "$asb" "$work\export"
    if ($LASTEXITCODE -ne 0) { Fail "导出模型贴图失败（退出码 $LASTEXITCODE），请把上方报错截图发回。" }
    # Animator：把关联动画烘进 FBX；AnimationClip：.anim YAML 备选。失败只警告，不影响模型贴图
    Log '导出动画（Animator + AnimationClip）…'
    & $cli.FullName --game SR --map_op "Load,AssetMap" --map_type XML --map_name "$mapXml" --types Animator AnimationClip --names "$filtersFwd" --group_assets ByContainer --silent "$asb" "$work\export"
    if ($LASTEXITCODE -ne 0) { Warn "导出动画失败（退出码 $LASTEXITCODE），动画可能缺失，模型贴图不受影响。" }
} finally { Pop-Location }
$fbxList = Get-ChildItem "$work\export" -Recurse -Filter *.fbx -ErrorAction SilentlyContinue
if (-not $fbxList) { Fail '没有导出任何 FBX，筛选规则可能不对。请把 work\candidates.txt 和 work\filters.txt 发回。' }
Log "导出完成：$($fbxList.Count) 个 FBX"

# ============ 6. FBX → GLB ============
Log '第 6/6 步：批量转换 GLB…'
$glbDir = Join-Path $out 'catcakes-glb'
$null = New-Item -ItemType Directory -Force $glbDir
$exportRoot = (Resolve-Path "$work\export").Path
$ok = 0; $bad = 0
foreach ($fbx in $fbxList) {
    $rel = $fbx.Directory.FullName.Substring($exportRoot.Length).TrimStart('\')
    $targetDir = Join-Path $glbDir $rel
    $null = New-Item -ItemType Directory -Force $targetDir
    $target = Join-Path $targetDir $fbx.BaseName
    & $f2g.FullName --binary --input "$($fbx.FullName)" --output "$target" 2>&1 | Out-Null
    if (Test-Path "$target.glb") { $ok++ } else { $bad++; Copy-Item $fbx.FullName $targetDir -Force; Warn "转换失败：$($fbx.Name)（原始 FBX 已保留）" }
    # 同目录的 PNG 贴图一并拷过去（FBX 里可能没嵌贴图，留备份）
    Get-ChildItem $fbx.Directory.FullName -Filter *.png -ErrorAction SilentlyContinue |
        Copy-Item -Destination $targetDir -Force
}
# 散落的贴图也整棵拷一份，防止漏
Get-ChildItem "$work\export" -Recurse -Filter *.png -ErrorAction SilentlyContinue | ForEach-Object {
    $rel = $_.Directory.FullName.Substring($exportRoot.Length).TrimStart('\')
    $td = Join-Path $glbDir $rel
    $null = New-Item -ItemType Directory -Force $td
    Copy-Item $_.FullName $td -Force
}
Log "转换完成：成功 $ok 个，失败 $bad 个"

$zipOut = Join-Path $out 'catcakes-glb.zip'
if (Test-Path $zipOut) { Remove-Item $zipOut -Force }
# tar.exe（Win10+ 自带）支持长路径；Compress-Archive 超 260 字符会炸
& tar.exe -a -c -f "$zipOut" -C "$glbDir" . 2>$null
if (-not (Test-Path $zipOut)) { Compress-Archive "$glbDir\*" $zipOut }
Write-Host ''
Write-Host "全部完成！请把 $zipOut 发回给作者。" -ForegroundColor Green
if ($bad -gt 0) { Write-Host "（有 $bad 个转换失败，output\catcakes-glb 里的原始 FBX/PNG 也一并发回更好）" -ForegroundColor Yellow }
