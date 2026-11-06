# 验证与审核

当前工程维护日期：2026-11-06。Node / Rust 版本由 `.node-version` 与 `rust-toolchain.toml` 固定，依赖使用锁文件。

## 检查入口

```powershell
npm ci
cargo fetch --locked --manifest-path src-tauri/Cargo.toml
npm run format:check
npm run check
npm run test:release
npm run glib:check
npm run notices:check
npm test
cargo clippy --locked --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings
npm run build:app
$env:ADB_SHARE_EXE = "$PWD/src-tauri/target/release/adbshare.exe"
npm run test:integration
npm run test:ui
```

运行 `npm run package` 每平台只生成程序和完整同名 `.sha256`，源码使用 GitHub 自动归档。远端流程见 [发布说明](releasing.md)。

## V0.11.0 IPv6 与协议模式

- 每组支持仅 IPv4、仅 IPv6 和双协议；兼容旧 IPv4 配置。网卡检查包含当前地址归属、运行状态、地址就绪、协议套接字创建与实际绑定，启动前和开始监听前均重新检查。网卡无对应可用地址时禁用启动，仍可选择可用的单协议模式。
- Windows Rust 回归覆盖 IPv6 CIDR `/0` / `/64` / `/128`、地址族隔离、旧配置、跨协议端点冲突、缺失网卡在防火墙修改前被拒绝、预留端口后再次检查网卡、双协议第二个绑定失败时回滚、IPv6 二进制透传及停止撤销两种协议。前端另有 3 项网络逻辑回归。
- Windows 实际原生窗口回归通过：仅 IPv6 / 双协议配置保存、重载和启停，IPv6 命令方括号、运行中锁定模式、中英文及 640 × 480 布局。通过测试窗口回调模拟 IPv6 地址消失，确认双协议不能启动而 IPv4 单模式仍可操作；未更改系统协议栈。
- Windows adb 37.0.1 的 `-H "[::1]"` 能访问隔离 IPv6 服务，裸 `-H ::1` 实测解析失败。新程序的标准 adb 集成覆盖 IPv4、IPv6、双协议的设备列表、get-state、shell 及二进制 push / pull，并检查单协议拒绝另一地址族的连接。
- Windows 真实本机可用 IPv6 网卡的来源拒绝 / 单 IP 放行回归通过（同机套接字，不等同于双机 LAN 验收）。未注册的 COM 规则对象验证 IPv6 单 IP、`/64`、`::/0` 可用；系统拒绝 `::1` 来源规则，生成非回环规则时过滤仅含 IPv6 未指定 / 回环地址的范围，由网关继续执行原访问策略。未创建、删除或修改实际系统防火墙规则。
- WSL Ubuntu 24.04 通过 Rust 回归、Clippy、3 项前端网络测试；普通用户运行原生 Debug 程序（嵌入前端），通过 adb 37.0.1 集成，以及实际 WebKitGTK 的单 IPv6 / 双协议配置、命令与启停。正常中文字体和缺字回退两套窗口回归通过；字体仅供临时测试使用，未安装到系统。WSL 未发现可绑定的外部 IPv6 地址，外部 IPv6 网卡专项在该环境跳过，IPv6 回环测试正常执行。
- 本轮 Windows 使用 Node 24.14.1，WSL 测试脚本使用现有 Node 22.23.2，两端 Rust 均为工程固定的 1.99.1。本机没有构建或验收新的 Linux Release / AppImage，该项由下述 Ubuntu 22.04 双平台发布门禁补充；没有新增真实 Android、双机 IPv6 LAN 或实际 UAC 规则生效验证。
- 仅 IPv6 指共享入口；上游仍连接 `127.0.0.1`。尚未验证全系统禁用 IPv4 的运行方式。使用及兼容边界见 [IPv6 与协议模式](ipv6.md)。

## V0.11.0 发布门禁

版本清单统一为 0.11.0，主版本仍为 V0。发布分支通过 PR 检查后合并；主分支工作流成功且提交 SHA 对齐后，再推送注释标签 V0.11.0。标签工作流在 Windows x64 和 Ubuntu 22.04 x64 上分别构建 EXE / AppImage，执行标准 adb 集成；Linux 另对实际 AppImage 执行正常字体与缺字回退的 WebKitGTK 回归。仅当两平台均成功时发布四个程序 / 校验文件。

两平台 CI 的 Android Platform Tools 固定为已验证的 37.0.1，官方归档地址及 SHA-256 见 `scripts/tests/install-platform-tools.mjs`。工具归档还与 Google stable SDK 元数据中的大小及 SHA-1 核对；这些是测试工具，不加入程序发布附件。下面的本机与 WSL 记录描述本地验证，最低 Ubuntu 22.04 的 AppImage 验证由上述 CI 门禁补充。

## 来源地址范围与公网中转

- 来源配置允许任意有效 IPv4 / CIDR，保留格式和前缀 0–32 校验；单 IP、公共地址段、跨越私有网段边界的 CIDR 和 `/0` 均可保存。来源匹配仍按实际 TCP 对端地址和 CIDR 边界执行，配置公网地址不会自动放行其他来源。
- Windows 本机通过 38 项 Rust 测试、Clippy、Release 构建、标准 adb 37.0.1 集成与完整原生窗口回归。验证公网来源保存 / 启停 / 重载、中英文非阻断警告、混合来源、局域网范围不警告、跨私有边界范围警告及非法 IPv4 仍被拒绝。
- Windows 防火墙地址属性通过未注册的 COM 规则对象验证：公网单 IP、CIDR、跨私有边界网段可解析；字面 `/0` 不被接受，程序将覆盖全部 IPv4 的来源转换为 `*`，仍以组的 IPv4 监听地址限定本地端点。该检查没有增删实际系统规则，也没有执行真实 UAC 规则变更。
- WSL Ubuntu 24.04 的全部 Rust 测试、Clippy、原生 Release 构建、标准 adb 集成及正常字体 / 缺字两套 WebKitGTK 回归通过，包含公网来源配置保存、启动和中英文警告。测试使用独立临时目录和虚拟设备，未连接实际公网中转服务器；没有新增真机、双机 LAN 或最低版本 AppImage 验证。

## ADB 命令适配与 F1 帮助

- Windows 本机通过 36 项 Rust 测试、Clippy、前端与 Release EXE 构建、标准 adb 37.0.1 隔离集成及完整原生窗口回归。验证默认 / serial / transport-id / USB / 网络选择、状态与组合等待、限定设备的 reconnect、只读诊断和两种 protobuf 跟踪；端口映射及全局管理请求继续被拒绝。
- 新增协议回归覆盖组外设备排除、多设备歧义、禁用设备撤销等待、offline 与 disconnect 的区别、上游查询失败不误报断开、protobuf 二进制保真与文本转义、跟踪空闲超过普通请求超时以及仅配置变化时的可见设备更新。
- Windows 实际 WebView 检查帮助按钮位于“关于”右侧且为方形，F1 重复打开、Esc 返回输入焦点、键盘切换页签、中英文 / 明暗主题、嵌套弹窗和退出过程保护。640 × 480 下标题与关闭按钮保持可见，内容仅纵向滚动。
- WSL Ubuntu 24.04 使用 Node 24.14.1、Rust 1.99.1 和 adb 37.0.1，通过全部 Rust 测试、Clippy、原生 Release 构建及相同标准 adb 集成。独立临时目录中以普通用户运行实际 WebKitGTK / Xvfb，帮助按钮、支持表、F1 事件处理与关闭通过；同时通过正常中文字体和仅拉丁字体的两套原生界面回归，没有安装字体或修改系统设置。
- 本轮 Linux 验证使用原生可执行文件，没有重新构建或验收最低 Ubuntu 22.04 AppImage。没有新增真机 Android、多台电脑 LAN、真实 UAC 防火墙变更或全部 adb 版本的验证，不能据此承诺 IDE / 投屏与全部高级安装流程兼容。功能范围见 [ADB 命令支持范围](adb-support.md)。

## glib 安全补丁

Linux 依赖链保留 GTK3 兼容的 glib 0.18.5，仅回移上游 PR #1343 的两行修复。源码、许可证、原始包校验值和差异见 [第三方源码补丁](../third_party/README.md)。`npm run glib:check` 同时检查整个源码目录、实际 Cargo 解析图和锁文件；不全局忽略漏洞公告。

```bash
npm run build
cargo test --locked --manifest-path src-tauri/Cargo.toml --test glib_variant_iter
cargo test --locked --release --manifest-path src-tauri/Cargo.toml --test glib_variant_iter
```

上述测试直接使用 `gtk::glib`，检查 `VariantStrIter` 的正向 / 反向 / 双端混用、跳跃、耗尽和字符串内容。Release 使用应用优化配置，不能仅以 Debug 通过作为修复证据。Linux CI 明确执行两种模式，并继续构建实际 AppImage，运行标准 adb 集成、WebKitGTK 窗口及缺字回退回归。Windows CI 也核对补丁、锁文件和许可证，并保持原有构建及集成检查。

## 中文字体回退

- Windows 本机重新通过 28 项 Rust 测试、Clippy、Release 构建、标准 adb 集成及完整原生窗口回归。切换中文会先完成异步确认，再保存选择；重载测试等待切换完成后核对保存结果。
- WSL Ubuntu 24.04 普通用户的实际 WebKitGTK 窗口：有中文字体时检测通过，中文 / 英文切换、英文选择重载及原有共享功能回归通过。中文测试字体只放在临时测试目录，没有安装到系统或加入程序成果物。
- 仅有 DejaVu Sans 拉丁字体的独立 Fontconfig 环境：首次启动回退并保存英文，预置中文偏好后重载仍改存英文，中文选择被拒绝，主题保留，语言按钮使用 SVG 路径。
- 在同一缺字环境输入包含中文及生僻字的组名，切换被拒绝后草稿不变，保存的 JSON 内容逐字一致。界面回退不替换或过滤用户输入；缺少系统字形时，这些用户内容仍可能无法显示。
- 检测错误及超过 5 秒的等待分别注入到测试页面的字体 IPC 响应，界面保持英文并恢复可操作；迟到的成功响应不会把语言改回中文。生产程序没有测试字体覆盖开关。
- Linux CI 的正向用例准备 `fonts-noto-cjk`，负向用例使用临时字体目录及缓存，仅包含拉丁字体。这些是构建 / 测试依赖，程序不下载或安装字体；AppImage 回归以实际打包成果物执行两个用例。

```bash
npm run test:linux-ui
npm run test:linux-ui -- --font-fallback
```

字体策略及用户配置约定见 [平台支持](platforms.md)。测试目录均有所有权标记，负向用例的字体文件只存在于自行创建并回收的系统临时目录。

## Linux 首版适配

以下记录为 V0.9.0 发布前的 Linux 首版适配过程；当时的内部构建仍使用 0.8.0 版本号，没有修改历史发布。正式发布使用独立 V0.9.0 标签，平台范围及约束见 [平台支持](platforms.md)。

- Windows 本机：28 项 Rust 测试、Clippy、Release EXE 构建、标准 adb 合成设备集成和完整原生窗口回归通过。日志导出已改用 Tauri Dialog，测试验证选定文件的实际内容。
- Windows 另行验证默认配置路径位于用户目录，复制 EXE 到其他目录后再次启动会唤起原实例，第二个进程正常退出；此检查不写入默认业务配置。
- WSL Ubuntu 24.04：27 项 Rust 测试和 Clippy 通过；Windows 专用辅助进程参数测试不在 Linux 编译。root 在无显示环境下打印提示并以状态码 1 退出，没有创建覆盖目录。
- WSLg 的 X11 会话中，以普通用户运行实际 WebKitGTK 窗口，设备发现、USB 权限状态、外部防火墙提示、共享启停、文本复制、日志和删组回归通过。该精简 WSL 环境缺少中文字体，截图存在缺字，不能据此认定中文视觉验收通过；字体要求见平台说明。
- WSLg 另行验证默认 XDG 配置路径与重复启动唤起；GTK 原生保存对话框可保存到选定文件，文件内容核对一致。这些是普通用户的原生程序检查，不能替代最低版本 AppImage 的验证。
- 新增无系统防火墙后端的生命周期回归，覆盖启停、规则请求拒绝、删组和退出不创建台账；测试使用独立虚拟 ADB 上游。新增 Linux `no permissions` 状态解析与 EXE / AppImage 打包约束检查。
- Ubuntu 22.04 CI：构建 AppImage，检查 root 拒绝启动，使用实际 AppImage 执行标准 adb 合成设备集成和原生 WebKitGTK 界面回归，全部通过。功能提交 `73d149d` 的 [双平台工作流](https://github.com/woooooooooolf/ADBShare/actions/runs/41981048147) 同时通过 Windows x64 和 Linux x64 作业，每平台上传程序及同名校验文件两个成果物。
- 程序外删除旧内部测试配置 `artifacts/data/` 和 `src-tauri/target/release/data/`；保留 `artifacts/archive/0.1.0/data/` 和用户 WebView 缓存。本轮检查未发现系统中残留的 `ADBShare-*` 防火墙规则。

Linux 界面回归需要普通用户、官方 tauri-driver 2.0.5、WebKitWebDriver、D-Bus 桌面会话和显示服务。CI 使用 Xvfb；本地可在正常桌面中执行：

```bash
export ADB_SHARE_EXE="$PWD/src-tauri/target/release/adbshare"
npm run test:integration
dbus-run-session -- xvfb-run -a npm run test:linux-ui
```

当前自动化证据不能替代实际 Ubuntu/Kubuntu 桌面（包括 Wayland）、Debian 12、干净系统离线运行、FUSE 挂载和真实 Android USB / 双机局域网测试。CI 的解包启动验证只证明该运行方式，不证明所有 FUSE 环境均兼容。

## 本轮审核与整理

- 前端拆出共享类型、页面骨架、关于页、活动窗口和弹窗模块；Rust 拆出元数据与平台资源，核心协议和共享撤销边界保持原有语义。
- 测试脚本集中到 `scripts/tests/`，图标及许可证维护脚本放在 `scripts/tools/`；统一格式，并启用 TypeScript 未使用项检查。
- 删除未使用的翻译、样式和重复设备原始行字段，配置比较直接使用结构相等判断，去掉中间 JSON 转换。
- 修正草稿设备数量的侧栏显示、上游错误文本的 HTML 转义、切换上游后的过期设备查询；后者补充受控延迟响应的回归测试。
- 窗口测试和演示使用自己的 WebView2 数据目录；测试工作区有标记，重复运行不再累积临时 EXE、导出文件和浏览器数据。
- 清理本地旧日志、一次性下载、重复试用包和编译缓存，保存配置文件哈希前后核对记录；已发布 V0.8.0 附件和历史交付文件单独归档。

### 本地整理结果

| 目录                |     整理前 |   整理后 |
| ------------------- | ---------: | -------: |
| `src-tauri/target/` | 6716.9 MiB | 22.1 MiB |
| `work/`             |   43.4 MiB |  8.7 MiB |
| `artifacts/`        |   39.1 MiB | 22.8 MiB |

合计移除约 6.6 GiB 可重建缓存和冗余输出。两份原有运行配置与四个正式发布文件逐项校验未变；清理后保留的独立 Release EXE 再次通过标准 adb 集成。详细本地哈希及目录记录保留在 `work/review/`，不提交个人配置。

## 发布约束检查

- `npm run test:release` 验证正文移除版本主标题，只保留依次排列的 `Changed`、`Fixed`、`Docs` 小标题与无序列表，并拒绝额外段落、缺失 / 重复小节和空列表。
- 用独立目录验证打包恰好生成 `ADBShare-0.8.0-windows-x64.exe` 与 `ADBShare-0.8.0-windows-x64.exe.sha256`，文件内容与实际 EXE 的 SHA-256 一致。
- 同目录内已识别的旧单文件 `SHA256SUMS` 可被替换；不符合本程序单文件格式的旧清单会被拒绝且保持原样。
- 平台构建成果物不包含发布说明文件；说明在独立发布任务的临时目录生成。既有 Release 的说明和附件不追溯修改，后续规范见 [固定发布约束](releasing.md#固定发布约束)。

## 自动化覆盖

- 整理基线为 26 项 Rust 测试；本次平台适配后 Windows 为 28 项、Linux 为 27 项。涵盖来源范围、原子配置、设备精确授权、双向二进制、停止撤销、设备禁用、内存历史、规则失败恢复、外部防火墙模式及上游端口切换。
- 标准 adb 与隔离虚拟上游：设备列表、get-state、shell v2、transport-id、二进制 push/pull 和跨组隔离。
- 实际 Tauri 窗口：原生窗口缩放至 1600×960、1000×700、760×600、640×480；无横向溢出，标题及操作同排，普通弹窗外部关闭。
- 本机 ADB 不可用提示及恢复、零设备状态、草稿保留、设备选择、共享启停、规则移除、删组失败重试、日志复制 / 导出 / 重置、中英文 / 明暗主题、关于页及原生退出。
- 专项回归验证设备数量即时反映草稿，错误内容作为文字显示，不生成来自上游错误的 HTML 元素。

窗口测试只操作自行创建的 EXE、配置、虚拟上游和原生辅助进程；不会使用用户 WebView2 目录，也不会自动关闭用户程序。

## 验证边界与历史

本轮没有连接真实 Android 设备，没有执行真实 UAC 防火墙规则变更，也没有验证双机局域网。模拟测试和窗口检查不能替代这些实机验证。

截图保留在 [images/](images/)。按时间记录的旧验证过程见 [验证历史](archive/validation-history.md)，旧设计讨论见 [设计历史](archive/design-history.md)。当前模块说明见 [工程结构](architecture.md)。
