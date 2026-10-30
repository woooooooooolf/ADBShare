$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$exe = Join-Path $root 'src-tauri\target\release\adbshare.exe'
if (-not (Test-Path -LiteralPath $exe)) { throw '请先运行 npm run build:app' }
$dir = Join-Path $root 'artifacts'
New-Item -ItemType Directory -Path $dir -Force | Out-Null
$name = 'ADBShare-0.1.0-windows-x64.exe'
Copy-Item -LiteralPath $exe -Destination (Join-Path $dir $name) -Force
$readme = @'
# ADBShare 0.1.0 原型

运行本目录的 ADBShare-0.1.0-windows-x64.exe。无需安装本工具；Windows 需具备 WebView2 Runtime。

1. 本机需要已有 ADB Server 和允许 USB 调试的设备。可从界面左下角设置 adb 路径并启动 Server。
2. 新建共享组，选择设备、实际局域网网卡、空闲端口和获准来源 IP/CIDR。
3. 保存配置。按需要点击“配置放行…”并由用户批准 UAC，然后开始共享。
4. 在获准远端主机执行界面右侧的 adb -H / -P 命令。

运行中先停止再编辑；关闭主窗口会停止全部共享。本机仍可使用原来的 ADB。
选择 127.0.0.1 只能在同一电脑测试。防火墙规则仅适用于专用/域网络。
配置保存于本目录的 data/config.json，程序目录需要可写。
删除组前可点“移除规则…”清理创建过的防火墙规则；移动 EXE 后需重新配置规则。

本原型已通过模拟上游、标准 adb 客户端和实际窗口交互测试。真机、双机 LAN 和实际 UAC 防火墙操作仍待验证。
forward/reverse、IDE 和投屏不属于本原型支持范围。
完整源码、虚拟设备演示和验证记录位于 adb_share 工程目录。
'@
[IO.File]::WriteAllText((Join-Path $dir 'README.md'), $readme + "`n")
$hash = (Get-FileHash -LiteralPath (Join-Path $dir $name) -Algorithm SHA256).Hash.ToLowerInvariant()
[IO.File]::WriteAllText((Join-Path $dir 'SHA256SUMS'), "$hash  $name`n")
Write-Output (Join-Path $dir $name)
Write-Output "SHA256 $hash"
