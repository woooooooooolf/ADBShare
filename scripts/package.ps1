$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$exe = Join-Path $root 'src-tauri\target\release\adbshare.exe'
if (-not (Test-Path -LiteralPath $exe)) { throw '请先运行 npm run build:app' }
$dir = Join-Path $root 'artifacts'
New-Item -ItemType Directory -Path $dir -Force | Out-Null
$name = 'ADBShare-0.1.0-windows-x64.exe'
Copy-Item -LiteralPath $exe -Destination (Join-Path $dir $name) -Force
Copy-Item -LiteralPath (Join-Path $root 'LICENSE') -Destination (Join-Path $dir 'LICENSE') -Force
Copy-Item -LiteralPath (Join-Path $root 'THIRD_PARTY_NOTICES.txt') -Destination (Join-Path $dir 'THIRD_PARTY_NOTICES.txt') -Force
$readme = @'
# ADBShare 0.1.0 原型

运行本目录的 ADBShare-0.1.0-windows-x64.exe。无需安装本工具；Windows 需具备 WebView2 Runtime。

1. 本机需要已有 ADB Server 和允许 USB 调试的设备。可从界面左下角设置 adb 路径并启动 Server。
2. 新建共享组，选择设备、实际局域网网卡、空闲端口和获准来源 IP/CIDR。
3. 保存并共享；启用组自动应用最新防火墙规则，按提示批准 UAC。停止共享保留规则；移除规则会先停止组。
4. 在获准远端主机执行界面右侧的 adb -H / -P 命令。

运行中先停止再编辑；删除组会自动停止共享并清理规则。关闭主窗口会停止全部共享并清理规则。
清理失败或取消 UAC 时，保留共享组或窗口，方便重试。本机仍可使用原来的 ADB。
选择 127.0.0.1 只能在同一电脑测试。防火墙规则仅适用于专用/域网络。
配置保存于本目录的 data/config.json，程序目录需要可写。
有待清理的防火墙规则时可能请求 UAC。移动 EXE 后需重新配置规则。

本原型已通过模拟上游、标准 adb 客户端和实际窗口交互测试。真机、双机 LAN 和实际 UAC 防火墙操作仍待验证。
forward/reverse、IDE 和投屏不属于本原型支持范围。
完整源码、虚拟设备演示和验证记录位于 adb_share 工程目录。
侧栏运行日志可查看全局 / 组 / 设备状态与交互预览，并复制、保存到文件或重置；记录只保存在本次运行内存中。
日志内可启用 / 禁用单台设备，禁用保留历史；从组中移除设备清除该组内的设备历史。
侧栏底部可切换语言、主题和打开关于页；本机设备入口可查看全部设备。
许可证：GPLv3（GPL-3.0-only），作者：wooooooooolf。
关于页内置许可证与第三方声明；本目录另附许可证、声明及对应源码包。
'@
[IO.File]::WriteAllText((Join-Path $dir 'README.md'), $readme + "`n")
& (Join-Path $PSScriptRoot 'package-source.ps1')
$sums = @($name,'ADBShare-0.1.0-source.zip','LICENSE','THIRD_PARTY_NOTICES.txt') | ForEach-Object {
    $hash = (Get-FileHash -LiteralPath (Join-Path $dir $_) -Algorithm SHA256).Hash.ToLowerInvariant()
    "$hash  $_"
}
[IO.File]::WriteAllText((Join-Path $dir 'SHA256SUMS'), ($sums -join "`n") + "`n")
Write-Output (Join-Path $dir $name)
Write-Output ($sums[0])
