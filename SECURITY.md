# 安全问题反馈

安全修复优先面向最新发布版本。

如果发现越权访问、来源限制绕过或其他安全问题，请使用 GitHub 的 [私密漏洞报告](https://github.com/woooooooooolf/ADBShare/security/advisories/new)，提供版本、运行平台、复现步骤和影响范围。在问题确认与修复前，请勿将敏感细节发布到公开 Issue。

普通使用问题和功能建议请提交 [Issue](https://github.com/woooooooooolf/ADBShare/issues)。程序的可信局域网使用范围及功能限制见 [README](README.md)。

## 第三方补丁

当前开发源码为 GTK3 依赖的 glib 0.18.5 回移了 RUSTSEC-2024-0429 的上游修复，来源、逐文件校验和 Debug / Release 回归入口见 [第三方源码补丁](third_party/README.md)。版本仍为 0.18.5，不全局忽略漏洞公告。此修复尚未进入已发布的 V0.9.0 附件。
