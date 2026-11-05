# 工程结构与维护约定

本工程保持原生 TypeScript + Tauri / Rust，配置格式版本仍为 1。V0.8.0 是已发布基线，当前整理属于后续开发，不修改历史标签或发布附件。

## 目录职责

```text
src/
  main.ts                 应用状态、共享组编辑、设备刷新与事件协调
  types.ts                IPC 数据结构与视图回调类型
  i18n.ts / icons.ts       本地化与图标
  style.css               布局、组件样式与响应式规则
  ui/
    template.ts           静态页面骨架
    about.ts              关于页与许可证表格
    activity.ts           全局 / 组 / 设备活动窗口
    dialogs.ts / dom.ts   确认、外部关闭和 DOM 工具
src-tauri/src/
  app.rs                  应用状态、配置 / 运行生命周期与 IPC 命令
  about.rs                程序元数据与离线许可证目录
  model.rs / protocol.rs  配置约束、原子保存及 ADB 帧与设备解析
  gateway.rs              来源校验、设备授权、连接撤销与字节流透传
  history.rs              有界内存记录与设备状态变化
  firewall.rs             防火墙规则及失败恢复台账的公共逻辑
  firewall/windows.rs     Windows 规则查询、提权辅助进程及 COM 操作
  fonts.rs                Linux GTK/Pango 中文字形检测与跨平台 IPC
  platform.rs             Windows 隐藏进程与 Linux 普通用户检查
scripts/
  build-app.mjs           锁定依赖的应用构建
  version.mjs             跨清单版本检查与发布说明
  notices.mjs             从锁定依赖生成 / 核对第三方声明
  package.mjs             每平台只输出程序与完整同名 .sha256
  demo.ps1 / clean.ps1    隔离演示与生成物清理
  tests/                  虚拟上游、集成 / 窗口回归及专用原生辅助脚本
  tools/                  手工图标与许可证维护工具
licenses/supplements/      上游未随包附带的许可证原文及来源记录
docs/                     当前架构、验证与发布说明
  archive/                历次设计讨论和验证历史
  images/                 保留的实际窗口截图
```

## 实现边界

- `main.ts` 管理当前草稿、保存配置和忙碌状态；关于页、日志及弹窗各自持有界面状态，通过明确的回调协调，不相互导入入口模块。
- `types.ts` 镜像 Rust 的 IPC 响应。修改 IPC 字段时同步检查两端，界面始终转义插入 HTML 的外部文本。
- `App.inner` 串行化配置和运行状态变更；停止组先撤销并等待连接结束，删除 / 清理规则继续沿用已有的失败重试边界。
- 设备禁用仅撤销对应设备会话，记录以组和设备划分；设备移出组或组删除后清除对应历史。
- 刷新设备前后核对上游端口，旧端口的迟到结果不再更新新配置的界面或历史。
- Windows 防火墙实现通过条件编译隔离；Linux 的 `App.firewall` 为 `None`，不读取台账或调用系统规则。前端根据后端 `automaticFirewall` 能力显示按钮及说明。
- 配置通过 Tauri Path API 定位；日志保存使用官方 Dialog 的 Rust API，文本复制使用官方 Clipboard Manager，普通启动使用 Single Instance。Linux 有效 UID 为 0 时在应用入口退出。
- Linux 中文界面就绪检查复用 GTK/Pango；所有 GTK 对象留在主线程。前端在首次显示前确定并保存实际语言，缺字或检测失败时使用英文，不保留原先的中文选择。检测文案来自中文翻译与事件名称，语言按钮始终为 SVG 路径。
- 完整许可证仍在仓库和程序中；关于页仅展示组件名、版本及许可证表达式。维护工具不会在普通构建中自动更新外部许可证。

## 生成物与用户数据

| 位置                                        | 用途                            | 清理规则                                                       |
| ------------------------------------------- | ------------------------------- | -------------------------------------------------------------- |
| `node_modules/`、`.npm-cache/`              | 项目本地依赖及下载缓存          | 与源码分开，不自动删除                                         |
| `dist/`                                     | Vite 构建输出                   | 可重建，`npm run clean` 清理                                   |
| `src-tauri/target/`                         | Rust 构建输出与缓存             | `-BuildCache` 清编译缓存及符号 / 中间文件，保留 EXE 和运行数据 |
| `work/tests/`                               | 本次合成设备回归                | 带所有权标记，每次测试替换自己的目录                           |
| `work/demo/`                                | 虚拟设备演示                    | 不接触实际 ADB 或用户配置                                      |
| `work/tools/`、`work/review/`               | 本地工具及审核清理记录          | 不进入 Git 或发布附件                                          |
| `artifacts/unreleased/<平台-架构>/`         | 当前本地试用程序与校验文件      | 各平台独立目录，不改用户配置                                   |
| `artifacts/releases/`、`artifacts/archive/` | 已发布和历史交付文件            | 与当前试用产物分开保存                                         |
| Tauri 用户配置目录或 `ADB_SHARE_DATA_DIR`   | 程序运行配置及 Windows 规则台账 | 不属于生成缓存，清理命令不处理                                 |

本轮在程序外清除了旧内部测试设置 `artifacts/data/` 和 `src-tauri/target/release/data/`。历史交付及其配置快照仍在归档目录；程序不包含旧数据迁移或清理逻辑。用户目录、平台边界与后续约束见 [平台支持](platforms.md)。

## 常用维护命令

```powershell
npm run format
npm run format:check
npm run check
npm test
npm run build:app
npm run test:ui
npm run clean -- -WhatIf
npm run clean -- -BuildCache -WhatIf
```

清理命令采用固定目录白名单、完整路径校验和测试目录所有权标记，不调用 Git 清理，也不会删除真实运行配置。实际执行时移除 `-WhatIf`。
