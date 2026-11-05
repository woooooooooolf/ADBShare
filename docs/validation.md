# 验证与审核

当前工程维护日期：2026-11-05。Node / Rust 版本由 `.node-version` 与 `rust-toolchain.toml` 固定，依赖使用锁文件。

## 检查入口

```powershell
npm ci
cargo fetch --locked --manifest-path src-tauri/Cargo.toml
npm run format:check
npm run check
npm run test:release
npm run notices:check
npm test
cargo clippy --locked --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings
npm run build:app
$env:ADB_SHARE_EXE = "$PWD/src-tauri/target/release/adbshare.exe"
npm run test:integration
npm run test:ui
```

运行 `npm run package` 每平台只生成程序和完整同名 `.sha256`，源码使用 GitHub 自动归档。远端流程见 [发布说明](releasing.md)。

## Linux 首版适配

本轮实现范围及后续约束见 [平台支持](platforms.md)。版本保持 V0.8.0 开发基线，本轮不发布标签。

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
