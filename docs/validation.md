# 验证与审核

当前工程维护日期：2026-11-05。Node / Rust 版本由 `.node-version` 与 `rust-toolchain.toml` 固定，依赖使用锁文件。

## 检查入口

```powershell
npm ci
cargo fetch --locked --target x86_64-pc-windows-msvc --manifest-path src-tauri/Cargo.toml
npm run format:check
npm run check
npm run notices:check
npm test
cargo clippy --locked --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings
npm run build:app
$env:ADB_SHARE_EXE = "$PWD/src-tauri/target/release/adbshare.exe"
npm run test:integration
npm run test:ui
```

运行 `npm run package` 只生成 EXE 和 `SHA256SUMS`，源码使用 GitHub 自动归档。远端流程见 [发布说明](releasing.md)。

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

## 自动化覆盖

- 26 项 Rust 测试：6 项单元、8 项网关、12 项生命周期。涵盖来源范围、原子配置、设备精确授权、双向二进制、停止撤销、设备禁用、内存历史、规则失败恢复及上游端口切换。
- 标准 adb 与隔离虚拟上游：设备列表、get-state、shell v2、transport-id、二进制 push/pull 和跨组隔离。
- 实际 Tauri 窗口：原生窗口缩放至 1600×960、1000×700、760×600、640×480；无横向溢出，标题及操作同排，普通弹窗外部关闭。
- 本机 ADB 不可用提示及恢复、零设备状态、草稿保留、设备选择、共享启停、规则移除、删组失败重试、日志复制 / 导出 / 重置、中英文 / 明暗主题、关于页及原生退出。
- 专项回归验证设备数量即时反映草稿，错误内容作为文字显示，不生成来自上游错误的 HTML 元素。

窗口测试只操作自行创建的 EXE、配置、虚拟上游和原生辅助进程；不会使用用户 WebView2 目录，也不会自动关闭用户程序。

## 验证边界与历史

本轮没有连接真实 Android 设备，没有执行真实 UAC 防火墙规则变更，也没有验证双机局域网。模拟测试和窗口检查不能替代这些实机验证。

截图保留在 [images/](images/)。按时间记录的旧验证过程见 [验证历史](archive/validation-history.md)，旧设计讨论见 [设计历史](archive/design-history.md)。当前模块说明见 [工程结构](architecture.md)。
