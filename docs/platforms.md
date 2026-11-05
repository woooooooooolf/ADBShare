# 平台支持与实施约束

本页记录 V0.9.0 的 Linux 首版范围，后续迭代应遵守。V0.8.0 为 Windows 历史基线，V0.9.0 同时提供 Windows x64 EXE 和 Linux x64 AppImage，历史标签及附件不做追溯修改。

## 支持范围

| 项目         | 约定                                                                         |
| ------------ | ---------------------------------------------------------------------------- |
| Windows      | 保留 x64 独立 EXE，不增加 ARM64                                              |
| Linux        | x64 / amd64；Ubuntu、Kubuntu 22.04 起的 LTS 为主要目标，原生 Debian 从 12 起 |
| Linux 用途   | 共享本机连接的 Android 设备，远端仍使用标准 adb 客户端                       |
| 分发         | AppImage 与同名 `.AppImage.sha256`；暂不提供 deb、apt 源或其他包格式         |
| 桌面         | 面向正常登录的图形桌面；覆盖 X11 / Wayland 的验证目标，不承诺无桌面服务器    |
| 运行生命周期 | 关闭窗口停止共享；不增加 systemd、后台守护、开机自启或共享自动恢复           |
| 其他平台     | macOS、Linux ARM64、Windows ARM64 不在本轮范围                               |

发行版兼容目标不代表相应桌面版本仍在维护，也不代表所有派生发行版均已实测。具体证据见 [验证说明](validation.md)。

## 权限、ADB 与防火墙

- Linux 只支持普通用户运行。应用入口检查有效 UID；root（包括 sudo、su 和直接 root 登录）打印终端提示并以状态码 1 退出。检查发生在配置、共享服务及 Tauri 初始化之前。AppImage 运行时或动态链接器自身的启动失败发生在应用入口之前，不属于此检查能够接管的范围。
- 不提供权限修复助手，不自动修改用户组、udev、USB 设备权限或系统软件包。使用者自行准备调试环境。设备的“USB 权限不足”“待授权”“离线”分别显示；手机端授权仍需用户确认。
- 不内置或下载 ADB。复用本机已有 ADB Server，保留 ADB 路径与服务端口设置，以及显式的“启动 ADB”按钮；不自动终止、替换或提权已有 Server。桌面启动可能不继承 shell 配置中的 PATH，建议为自定义安装的 ADB 填写绝对路径。
- Linux 隐藏应用 / 移除系统防火墙规则的按钮，启停、删组和退出均不查询或变更系统规则，也不写防火墙台账。页面提示用户自行放行监听 TCP 端口；应用内部的来源 IP / 网段、设备授权及连接撤销保持生效。
- Windows 继续保留原有防火墙规则管理、按需 UAC 和失败重试流程。不要把 Linux 的 root 限制应用到 Windows 防火墙辅助进程。

## 配置与公共组件

使用 Tauri Path API 的 `app_config_dir()` 存放业务配置，仍使用版本 1 的 JSON 格式与 Rust 原子保存；WebView 的缓存 / LocalStorage 继续由 Tauri 管理。设备交互历史仅保存在进程内存中。

| 内容               | 默认位置                                                                                                         |
| ------------------ | ---------------------------------------------------------------------------------------------------------------- |
| Windows 配置       | `%APPDATA%\local.adbshare.desktop\config.json`                                                                   |
| Linux 配置         | `$XDG_CONFIG_HOME/local.adbshare.desktop/config.json`，未设置时为 `~/.config/local.adbshare.desktop/config.json` |
| Windows 防火墙台账 | 与业务配置同目录的 `firewall-rules.json`                                                                         |
| WebView 数据       | Tauri 的应用本地数据目录，与业务配置目录分开                                                                     |

- 不从 EXE / AppImage 相邻的旧 `data/` 迁移或删除配置，也不在普通启动时扫描旧目录。本轮内部测试数据在程序外一次性清理。
- `ADB_SHARE_DATA_DIR` 保留为测试 / 开发的显式目录覆盖。覆盖配置的测试进程不注册默认单实例插件，不触碰或唤起用户正常实例；不要并发运行多个写入同一覆盖目录的进程。
- 普通启动使用官方 Single Instance 插件，重复启动唤起已有窗口，避免默认配置并发写入。测试用 `--headless` 入口继续要求显式配置路径，Linux 同样拒绝 root。
- 原生日志保存使用官方 Dialog 插件的 Rust API；剪贴板使用官方 Clipboard Manager 插件。渲染器仅授予文本剪贴板写入权限，不开放通用文件系统权限或剪贴板读取。

## AppImage 构建与使用

以 Ubuntu 22.04 为最低构建基线，使用 Tauri Linux 配置仅生成 AppImage。不要用较新的宿主直接构建正式 Linux 成果物，以免抬高 glibc 要求。Windows 构建继续关闭安装包生成。

```bash
sha256sum -c ADBShare-VERSION-linux-x64.AppImage.sha256
chmod +x ADBShare-VERSION-linux-x64.AppImage
./ADBShare-VERSION-linux-x64.AppImage
```

如果目标环境无法使用 FUSE，可使用实际构建运行时支持的解包启动方式：

```bash
./ADBShare-VERSION-linux-x64.AppImage --appimage-extract-and-run
```

解包启动需要临时磁盘空间，启动可能更慢。AppImage 不等同于任意发行版上的完全静态程序，也不包含 ADB、USB 权限设置或防火墙配置。离线运行测试应在这些前置条件已满足后进行；首次赋予执行权限、不同桌面会话及实际产物的 FUSE 行为均属于验收范围。

界面使用系统字体，不内置完整字库或字形子集，也不自动下载 / 安装字体。

- Linux 在首次显示界面前，或用户请求切换中文时，使用 Tauri 已有的 GTK/Pango 排版组件检查内置中文文案及事件名称的字形支持；字体族与前端 CSS 保持一致。检测在 GTK 主线程执行，包含常规系统字体回退，不依赖某个字体名称或浏览器的字体加载状态检查。
- 确认缺字、检测报错或超过 5 秒时，实际界面及持久化语言均改为英文，语言按钮状态随之更新。不会保留隐藏的中文偏好，也不会在补齐字体后自动恢复中文。
- 缺字与检测异常使用不同的英文提示。用户可自行准备中文字体（例如发行版的 `fonts-noto-cjk`），重启后主动选择中文；已经选择英文的启动不额外检查中文字体。
- 语言按钮保持纯 SVG 路径，不使用文字字形或图标字体；提示与无障碍名称遵循实际界面语言。Windows 保留原有中英文选择行为。
- 检测保证的是内置界面文案的字形条件，不承诺任意用户文本均可显示。自定义组名、设备名、粘贴的中文 / 生僻字和日志原文仍依赖系统字体；程序保留原始 Unicode 内容，不替换、删除或改写用户输入。

开发环境还需要 Node / Rust 和 Tauri 的 Linux 构建依赖；具体命令以工作流为准。参考 [Tauri AppImage](https://v2.tauri.app/distribute/appimage/)、[Tauri 插件](https://v2.tauri.app/plugin/)、[Android Linux 设备设置](https://developer.android.com/studio/run/device#setting-up)。
