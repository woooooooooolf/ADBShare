# ADB 命令支持范围

ADBShare 是按组限制设备访问的 ADB 网关，远端通过 `adb -H <共享主机> -P <共享端口>` 使用。标准 ADB 的设备访问和查询在组内适配，连接、配对及全局管理保留给共享主机。它不会把两台电脑的 localhost、文件路径或端口变成同一资源。

程序左下角“关于”右侧的方形帮助按钮或 **F1** 可打开中英文使用指南、命令支持表和行为差异。帮助支持页签、键盘左右键切换、Esc 关闭和小窗口滚动。

以下示例省略 `-H/-P`；来源地址需要获准，设备需要属于当前组且已启用。“适配 / 透传”不代表所有设备或客户端版本都具备相应能力。

## 已适配的协议

| 命令 / 能力                                            | 行为                                                                                                                                                                       |
| ------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `devices`、`devices -l`                                | 仅返回当前组内已启用的设备。                                                                                                                                               |
| `track-devices`、`track-devices -l`                    | 提供组内文本设备跟踪，设备禁用后更新列表。                                                                                                                                 |
| `track-devices --proto-binary / --proto-text`          | 使用上游标准二进制消息，按 serial 精确过滤后输出二进制或 protobuf 文本。保留已知 AOSP 字段，包括状态、连接类型、速度和 transport id；需要上游支持对应协议。                |
| `-s SERIAL`、`-t ID`、`-d`、`-e`、默认选择             | 元数据查询和设备流均先在组内解析设备。`-d` 为 USB，`-e` 为网络设备 / 模拟器；有多台符合条件的设备时返回歧义错误。                                                          |
| `get-state`、`get-serialno`、`get-devpath`、`features` | 解析为明确的组内 serial 后转发，不能以组外设备满足默认或 USB / 网络查询。                                                                                                  |
| `wait-for[-TRANSPORT]-STATE`                           | 支持 `any/usb/local` transport，状态为 `device/recovery/rescue/sideload/bootloader/any/disconnect`，以及上游标准的多个状态组合。只根据组内设备判断，多设备歧义时明确报错。 |
| `reconnect`                                            | 先在组内确定唯一设备，再向上游发送针对该 serial 的重连请求。不会转发全局重连。                                                                                             |
| `server-status`、`mdns check`、`host-features`         | 提供共享主机上游 ADB 的只读诊断，不开放服务器管理权限。二进制状态消息不按 UTF-8 文本处理；上游不支持时返回上游错误。                                                       |

## 设备流透传

选定获准设备后，网关透传非 `host*`、非 `reverse:` 的设备服务，包括 `shell`、`exec-in/exec-out`、`logcat`、`push/pull`、`sync`、普通安装 / 卸载、`bugreport`、`jdwp`，以及 `reboot`、`root/unroot`、`remount`、`enable-verity/disable-verity`、`usb/tcpip`、`sideload`、`reconnect device` 对应的设备服务。

实际结果由客户端、上游 ADB 和设备共同决定。设备权限、当前模式、恢复模式、设备重启后的重连、安装高级选项及完整 IDE / 投屏流程并未逐项完成真机验收。若流程另外依赖下面的受限能力，仍会失败。

## 明确不开放的能力

| 命令 / 请求                     | 原因                                                                                                                                                 |
| ------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| `forward`、`reverse`            | 不提供端口映射，包括创建、`--no-rebind`、动态端口、`--list`、`--remove`、`--remove-all` 和设备 socket 映射。明确返回不支持，不向上游创建或删除映射。 |
| `connect`、`disconnect`、`pair` | 设备连接和配对由共享主机管理，避免远端改变主机连接及信任状态。                                                                                       |
| `kill-server`                   | 会停止所有组和本机共同使用的上游服务器。                                                                                                             |
| `attach`、`detach`              | 共享主机管理 USB 设备的接管与释放。                                                                                                                  |
| `reconnect offline`             | 上游为服务器级批量操作，不原样透传给远端。                                                                                                           |
| `mdns services`                 | 不开放包含未共享设备的全网发现列表。                                                                                                                 |
| 其他未适配的主机请求            | 默认拒绝；先选择设备不能绕过主机命令边界。                                                                                                           |

端口映射限制与来源 IP、防火墙或设备 USB 调试授权无关。依赖映射的调试 / 投屏流程不在兼容承诺内；普通单条或重复执行的 shell 不需要映射，也不会触发自动建隧道。

## 设备选择、等待和共享差异

- 推荐使用实际组内 serial 的 `-s SERIAL`。`-t ID` 使用上游 ADB transport id，重连后可能改变；已经消失、无法确认组归属的 id 不能用于新建请求。
- 默认和 `-d/-e` 的自动选择仅发生在当前组内，组外设备不造成歧义，也不会成为回退目标。使用明确 serial 的设备查询无需额外扫描上游列表。
- 等待命令可以等待当前组内设备出现。`disconnect` 等待 transport 从列表消失，单纯 `offline` 不视为断开；上游查询失败会返回错误，不会误报设备断开。
- 等待任意状态时使用 `wait-for-any-any`：第一个 `any` 是 transport，第二个是状态。标准客户端会把单独的 `wait-for-any` 解析成缺少状态的请求。
- 指定设备的等待会随设备禁用而撤销；自动选择的等待持续按当前组内已启用设备判断。停止共享组会撤销全部会话，客户端退出也会释放等待和跟踪连接。
- `wait-for-bootloader` 只等待上游报告的状态，不提供 fastboot 访问；设备是否会报告该状态取决于设备和上游。
- 本机和其他组可以同时使用同一设备，没有独占租约。`reconnect`、`reboot`、`root` 或切换调试模式可能影响所有使用同一设备的会话。组内访问授权不是只读权限，也不是设备内部命令的细分权限控制。
- `server-status` 描述共享主机的上游 ADB，不是 Remote 的本机 ADB，也不是 ADBShare 自身的运行状态。

## 客户端本地或范围之外

- `help`、`version`、`keygen`、`pubkey` 在 Remote 客户端本地执行；成功不表示网关支持全部命令。
- `start-server` 对已可用的共享入口可仅检查版本后成功返回，不会通过 ADBShare 启动上游。上游由共享主机“本机 ADB 设置”或本机 adb 管理。
- `server nodaemon` 等启动模式在执行 adb 的机器上运行。`emu` 的共享主机模拟器控制台、fastboot 均不提供代理。

来源支持任意有效 IPv4 / CIDR，包括公网中转服务器；超出私有、回环及链路本地网段时仅显示警告，不阻止保存或共享，`0.0.0.0/0` 表示所有 IPv4 来源。匹配的是 ADBShare 收到的 TCP 对端；本机隧道经回环地址接入时按本机连接处理，应在中转入口限制访问。当前没有账户认证或加密，公网 / 异地中转的访问控制和加密由使用者配置。Windows 自动规则仅适用于专用 / 域网络，来源 IP 的公网属性不会改变这一网络配置。

协议和虚拟设备回归不能替代真机、多机 LAN、公网中转与所有 adb 版本验证。当前验证情况见 [验证说明](validation.md)。

协议来源：[AOSP 服务协议](https://android.googlesource.com/platform/packages/modules/adb/+/HEAD/docs/dev/services.md)、[客户端命令实现](https://android.googlesource.com/platform/packages/modules/adb/+/HEAD/client/commandline.cpp)、[等待服务](https://android.googlesource.com/platform/packages/modules/adb/+/HEAD/services.cpp)、[设备跟踪 schema](https://android.googlesource.com/platform/packages/modules/adb/+/HEAD/proto/adb_host.proto)。
