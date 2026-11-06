# 第三方源码补丁

## glib 0.18.5

- 原始源码：[crates.io 发布包](https://static.crates.io/crates/glib/glib-0.18.5.crate)，完整解包到 `glib-0.18.5/`，保留 `LICENSE`、`COPYRIGHT` 及其他原始文件。
- 原始包 SHA-256：`233daaf6e83ae6a12a52055f568f9d7cf4671dabb78ff9560ab6da230ce00ee5`，与修改前 Cargo.lock 的 checksum 相同。
- 原始版本保持 **0.18.5**，许可证为 MIT；不以修改版本号的方式满足漏洞扫描。
- 风险：[RUSTSEC-2024-0429](https://rustsec.org/advisories/RUSTSEC-2024-0429.html) / [GHSA-wrw7-89jp-8q8g](https://github.com/advisories/GHSA-wrw7-89jp-8q8g)。
- 上游修复：[gtk-rs-core PR #1343](https://github.com/gtk-rs/gtk-rs-core/pull/1343)，提交 [`b5a4071e439bef2b5eea76c3aa25e5ae84839e34`](https://github.com/gtk-rs/gtk-rs-core/commit/b5a4071e439bef2b5eea76c3aa25e5ae84839e34)。原始补丁保存在 `patches/glib-0.18.5-variant-str-iter.patch`。

仅回移 `src/variant_iter.rs` 的两行变更：将 `let p` 改为 `let mut p`，向 `g_variant_get_child` 传入 `&mut p`。该 C 可变参数函数会写入输出指针，原来的不可变引用违反 Rust 约束，优化构建可能因此读取空指针。其他源码、清单、测试及许可证逐字保留。

`src-tauri/Cargo.toml` 的 `[patch.crates-io]` 将整条 GTK/Tauri 依赖链统一解析到本目录。锁文件的 glib 版本仍为 0.18.5，但不再有 registry source / checksum；这是本地源码替换的正常表示，并非升级到 glib 0.20。保留 GTK3 的版本兼容性。

## 验证与维护

`glib-0.18.5.source.json` 保存原始包、上游提交、补丁及原始 121 个文件的 SHA-256。`npm run glib:check` 离线检查：

- 文件集合及逐文件校验值符合记录，只有指定文件允许变化；反转两行补丁后必须恢复原始文件校验值。
- 上游补丁文件校验值正确。
- Linux Cargo 依赖图仅有一个 glib，版本为 0.18.5、路径指向本目录；所有调用方引用同一实例，锁文件也使用本地来源。

迭代器回归位于 `src-tauri/tests/glib_variant_iter.rs`，通过 `gtk::glib` 使用应用实际依赖，覆盖正向、反向、双端混用、跳跃、末项、空数组、耗尽、越界，以及空字符串、中文、Emoji 和长字符串。Linux CI 在 Debug 和 Release 两种模式运行，再验证实际 AppImage 和 WebKitGTK 桌面功能。

```bash
npm run glib:check
npm run build
cargo test --locked --manifest-path src-tauri/Cargo.toml --test glib_variant_iter
cargo test --locked --release --manifest-path src-tauri/Cargo.toml --test glib_variant_iter
```

Release 沿用应用的优化配置（`opt-level = "s"`、LTO、单 codegen unit）。第三方源码不运行项目的自动格式化；Rust 格式检查限定 `--package adbshare`，避免引入无关修改。

本补丁只处理上述公告，不代表 glib 0.18 全部风险已消除。没有全局忽略 RustSec 或 Dependabot 规则；若扫描工具仅按版本号继续告警，应以本目录的来源、差异和回归结果核对。后续依赖链可升级到包含修复的兼容版本时，移除 `[patch.crates-io]`、本目录对应源码 / 补丁与专项完整性检查，再重新验证两平台。已有 V0.9.0 发布附件不包含本修复。
