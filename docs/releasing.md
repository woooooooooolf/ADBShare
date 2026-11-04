# 版本与发布

当前基线为 **V0.8.0**。仓库保持私有；Release 和 Actions 产物随仓库权限访问。

## 本地准备

1. 同步 `package.json`、`package-lock.json`、`src-tauri/Cargo.toml`、`src-tauri/Cargo.lock` 和 `src-tauri/tauri.conf.json` 的版本号。
2. 在 `CHANGELOG.md` 增加对应版本条目。
3. 运行 `npm run version:check`、`npm test` 和 `npm run build:app`。需要原生窗口回归时运行 `npm run test:ui`。
4. 提交并推送 `main`，等待该提交的 Windows x64 工作流通过。
5. 确认本地 HEAD、远端 main 和成功工作流的 head SHA 一致，再创建并推送注释标签。

```powershell
git tag -a V0.8.0 -m "ADBShare V0.8.0"
git push origin V0.8.0
```

标签支持 `Vx.y.z` / `vx.y.z`，必须与应用版本完全一致。不要移动已经发布的标签。

## 自动流程

`main` 推送、PR 和手动运行执行检查、测试与构建；版本标签额外触发 Release 发布。

- 使用固定 Node / Rust 版本、锁定依赖和固定提交 SHA 的官方 Actions。
- 构建阶段仅有仓库只读权限，不保存 checkout 凭据；只有独立发布任务拥有 `contents: write`。
- 不需要配置个人令牌、签名密钥或其他仓库 Secrets。
- Windows x64 产物包括独立 EXE、含说明与许可证的便携 ZIP、对应源码 ZIP 和 `SHA256SUMS`。
- 原生窗口交互回归在本机执行；云端运行 Rust 测试及标准 adb 与虚拟上游的集成测试。

运行 `npm run package` 将本地交付文件写入 `artifacts/<版本>/`。源码暂存目录在打包后自动清理；配置、日志、缓存、构建输出和 Git 元数据不会进入源码包。
