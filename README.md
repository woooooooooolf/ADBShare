# ADBShare

![首次运行主界面](docs/images/welcome.png)

将本机连接的 Android 设备按组共享给远端电脑，支持局域网访问和自行配置的跨网段 / 公网服务器中转，远端使用标准 `adb -H / -P` 命令访问。本机继续使用原有 ADB Server，无需将设备切换为网络调试模式。

## 功能

- 多组共享与设备隔离，限制允许接入的来源 IP / 网段。
- 共享组和单设备独立启停；Windows 防火墙规则管理与共享状态联动。
- 全局、组、设备三级运行日志，支持交互预览、复制、导出和重置。
- 组内标准设备选择、状态查询和等待，文本 / protobuf 设备跟踪及只读上游诊断。
- 左下角“关于”右侧的方形帮助按钮，或按 F1，打开使用指南、ADB 命令支持情况与行为差异。
- 中英文界面、明暗主题，Windows x64 独立 EXE 与 Linux x64 AppImage。

支持仅 IPv4、仅 IPv6 和双协议共享，包含网卡地址就绪检查、IPv6 来源限制及防火墙适配，详见 [IPv6 与协议模式](docs/ipv6.md)。

## 下载与使用

从 [Releases](https://github.com/woooooooooolf/ADBShare/releases) 下载程序及同名 `.sha256` 校验文件。V0.11.0 提供 Windows x64 EXE 和 Linux x64 AppImage。本项目不内置 adb，运行无需联网。

| 平台        | 运行条件                                                                                      |
| ----------- | --------------------------------------------------------------------------------------------- |
| Windows x64 | WebView2 Runtime、Android Platform Tools                                                      |
| Linux x64   | 目标 Ubuntu/Kubuntu 22.04 起的 LTS、Debian 12 起的桌面环境；本地 ADB 与正确的 USB / udev 权限 |

Linux 下载后赋予 AppImage 执行权限，并以普通用户启动；root / sudo 启动会打印提示并退出。详细边界及验证情况见 [平台支持](docs/platforms.md)。

Linux 缺少中文界面所需字体时会自动使用并保存英文，切换中文前重新检查。程序不内置字库，用户输入的中文仍需要系统字体支持。

1. 用本机 ADB 连接设备，并在设备上允许 USB 调试。必要时在“本机 ADB 设置”中启动 Server。
2. 新建共享组，选择设备、局域网网卡、共享协议、可用地址、空闲端口和允许的来源地址。
3. 点击“保存并共享”。Windows 按提示批准防火墙规则配置；Linux 请事先在系统防火墙中放行共享 TCP 端口。
4. 在获准的远端电脑执行界面中的命令：

```powershell
adb -H 192.168.1.10 -P 15037 devices -l
adb -H 192.168.1.10 -P 15037 -s SERIAL shell
```

Windows 停止组保留规则，移除规则会先停止组，删除组和退出程序会清理规则。Linux 不管理系统防火墙，来源地址限制仍由程序执行。

配置存放在用户专属目录，位置可在运行日志窗口查看；移动程序不影响配置。普通启动为单实例，重开程序不会自动恢复共享。日志仅保存在本次运行的内存中，交互数据为有上限的预览。

来源允许填写 IPv4 / CIDR（前缀 0–32）及 IPv6 / CIDR（前缀 0–128），包括公网中转服务器；每种监听协议至少配置一个同协议来源。超出私有、回环或链路本地网段的来源范围会显示警告，仍可保存和共享；`0.0.0.0/0` 会允许所有 IPv4 来源，`::/0` 会允许所有 IPv6 来源。来源白名单匹配 ADBShare 实际看到的 TCP 对端地址，中转后可能是中转服务器；本机隧道经回环地址接入时按本机连接处理，需要在中转入口限制访问。

当前不提供账户认证或加密，仅允许可信主机访问；公网或异地中转的访问控制和链路加密由使用者配置。Windows 自动防火墙规则适用于专用 / 域网络，需另行核对监听网卡的网络类型及中转链路规则。**不支持 `adb forward` / `adb reverse` 端口映射，包括创建、列表和删除**；依赖端口映射的调试或投屏功能无法通过本工具使用，不承诺 IDE 或投屏整体兼容性。此限制与设备授权、来源 IP 或防火墙配置无关。

共享入口不开放上游 ADB Server 的连接、配对和全局管理命令，包括 `connect`、`disconnect`、`pair`、`kill-server`、`attach/detach`、`reconnect offline` 及全网发现 `mdns services`。`server-status`、`mdns check` 提供上游只读诊断；`reconnect` 先在组内确定设备后执行，会影响所有使用同一设备的会话。支持 `-s/-t/-d/-e` 和组内默认选择，多设备歧义时需明确指定。完整分类与差异见 [ADB 命令支持范围](docs/adb-support.md)，实际验证边界见 [验证记录](docs/validation.md)。

## 开发

基于 Tauri 2、Rust 和 TypeScript。需要 Node.js 24 和工程指定的 Rust 工具链；Windows 另需 Visual Studio C++ Build Tools 和 WebView2，Linux 构建依赖见 [平台说明](docs/platforms.md)。

```powershell
npm ci
cargo fetch --locked --manifest-path src-tauri/Cargo.toml
npm run tauri -- dev

# 检查、构建与打包
npm run version:check
npm test
npm run build:app
npm run package
```

后续每平台仅提供程序文件和追加 `.sha256` 的同名校验文件，源码可使用 GitHub 在 Release 页自动提供的归档。交付文件位于 `artifacts/<版本>/`。运行 `scripts/demo.ps1` 可启动隔离的虚拟设备演示；更多检查见 [验证记录](docs/validation.md)。

## 工程结构与维护

- `src/`：应用入口、共享类型与独立界面模块。
- `src-tauri/src/`：配置、ADB 网关、内存历史、防火墙和平台实现。
- `scripts/tests/`：隔离回归；`scripts/tools/`：手工维护工具。

`npm run format` 统一源码格式，`npm run clean -- -WhatIf` 预览生成物清理。目录和数据保留约定见 [工程结构](docs/architecture.md)，检查命令及边界见 [验证说明](docs/validation.md)。

问题反馈使用 [Issues](https://github.com/woooooooooolf/ADBShare/issues)，安全问题使用 [私密报告](SECURITY.md)。代码和文档修改通过 PR 与双平台 CI 后合并，具体设置见 [仓库维护](docs/repository.md)。

## 版本与发布

**V0.11.0** 新增仅 IPv4、仅 IPv6 和双协议共享，提供网卡地址就绪与绑定检查，适配 IPv6 来源限制、远端命令及 Windows 分协议防火墙规则，兼容旧 IPv4 配置；主版本仍为 V0。GitHub Actions 检查主分支，在版本标签上构建并发布 Windows x64 EXE、Linux x64 AppImage 及各自的校验文件。成果物命名与 `Changed` / `Fixed` / `Docs` 简体中文说明规范固定保存在 [发布流程](docs/releasing.md)，修改点见 [更新记录](CHANGELOG.md)。

## 许可证

[GPLv3（GPL-3.0-only）](LICENSE)。第三方组件保留各自许可证，详见 [第三方声明](THIRD_PARTY_NOTICES.txt)。
