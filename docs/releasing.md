# 版本与发布

当前基线为 **V0.8.0**。仓库保持私有；Release 和 Actions 产物随仓库权限访问。

## 固定发布约束

以下约束适用于后续所有版本和新增平台，迭代时须同步遵守；已发布的 V0.8.0 标签、说明及附件不做追溯修改。

### 成果物

- 程序文件沿用 `名称-版本-平台-架构.后缀`，版本号与应用清单一致。
- 校验文件必须在完整程序文件名后追加 `.sha256`，不能省略程序后缀，也不再使用汇总文件 `SHA256SUMS`。
- 每个平台构建只产生并发布程序与其校验文件两个成果物，不手工打包 ZIP 或其他压缩包；源码使用 GitHub 自动归档。
- 校验内容采用小写 SHA-256、两个空格和程序文件名，末尾保留换行，支持在同一目录用 `sha256sum -c` 校验。
- 例如：`ADBShare-0.8.1-windows-x64.exe` 和 `ADBShare-0.8.1-windows-x64.exe.sha256`。
- Linux 使用 `ADBShare-0.8.1-linux-x64.AppImage` 和 `ADBShare-0.8.1-linux-x64.AppImage.sha256`；两平台均不额外打包压缩包。

### Release 说明

- 正文只按 `Changed`、`Fixed`、`Docs` 的顺序使用三级 Markdown 小标题，每节使用 Markdown 无序列表。
- 不在正文额外加入主标题、版本 / 日期标题、介绍段落或多语言段落；GitHub Release 自身的名称仍使用项目名和标签。
- 正文使用简体中文，关键名称、命令、平台、组件名和缩写保留英文。不提供多语言发布说明。
- 无内容的小节使用 `- 无。`，不要省略或重复小节。
- `CHANGELOG.md` 可以保留版本和日期索引；导出 Release 说明时自动移除版本标题，并检查小标题、顺序和列表结构。

后续条目与导出正文模板如下：

```markdown
### Changed

- 描述功能或行为的变更，关键名称如 ADB、Windows x64 保留英文。

### Fixed

- 描述修复的问题；没有修复项时填写“无。”。

### Docs

- 描述文档调整；没有文档调整时填写“无。”。
```

## 本地准备

1. 同步 `package.json`、`package-lock.json`、`src-tauri/Cargo.toml`、`src-tauri/Cargo.lock` 和 `src-tauri/tauri.conf.json` 的版本号。
2. 在 `CHANGELOG.md` 增加对应版本条目，正文遵循上面的三个小节及简体中文规范。
3. 运行 `npm run format:check`、`npm run version:check`、`npm run test:release`、`npm test` 和 `npm run build:app`。需要原生窗口回归时运行 `npm run test:ui`。
4. 提交并推送 `main`，等待该提交的 Windows x64 与 Linux x64 工作流全部通过。
5. 确认本地 HEAD、远端 main 和成功工作流的 head SHA 一致，再创建并推送注释标签。

```powershell
git tag -a V0.8.1 -m "ADBShare V0.8.1"
git push origin V0.8.1
```

标签支持 `Vx.y.z` / `vx.y.z`，必须与应用版本完全一致。不要移动已经发布的标签。

## 自动流程

`main` 推送、PR 和手动运行执行检查、测试与构建；版本标签额外触发 Release 发布。

- 使用固定 Node / Rust 版本、锁定依赖和固定提交 SHA 的官方 Actions。
- 构建阶段仅有仓库只读权限，不保存 checkout 凭据；只有独立发布任务拥有 `contents: write`。
- 不需要配置个人令牌、签名密钥或其他仓库 Secrets。
- 后续 Windows x64 发布仅上传独立 EXE 和同名 `.exe.sha256`；Linux x64 使用 AppImage 和同名 `.AppImage.sha256`。发布任务等待两个平台成功，合计四个文件；源码使用 GitHub 自动提供的归档。
- 已发布的 `V0.8.0` 附件保持原样；本格式调整从后续发布开始生效。
- Windows 原生窗口交互回归在本机执行；两平台 CI 均运行 Rust 测试及标准 adb 与虚拟上游的集成测试。Linux 另用官方 tauri-driver / WebKitGTK / Xvfb 测试实际 AppImage 的界面。
- Linux 构建固定为 Ubuntu 22.04，使用 `tauri.linux.conf.json` 生成 AppImage。不能直接把更新宿主构建的文件作为最低版本兼容证据。

在对应平台运行 `npm run package`，将程序和同名校验文件写入 `artifacts/<版本>/`。可以使用 `-- --output-directory DIRECTORY` 选择独立目录；目录中含其他文件时拒绝打包，不自动删除。项目许可证和第三方声明继续保留在仓库及程序内。

发布说明在独立发布任务中从同一提交生成，放入 Runner 临时目录；不会混入每个平台的构建成果物。
