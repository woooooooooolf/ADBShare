type HelpContent = {
  startTitle: string;
  steps: string[];
  examplesTitle: string;
  exampleHint: string;
  dailyTitle: string;
  daily: string[];
  supportHint: string;
  commandTitle: string;
  behaviorTitle: string;
  commands: [string, string][];
  validationHint: string;
  selectionTitle: string;
  selection: string[];
  boundaryTitle: string;
  boundaries: string[];
  troubleTitle: string;
  troubleshooting: string[];
};

export const helpContent: Record<'zh' | 'en', HelpContent> = {
  zh: {
    startTitle: '开始共享',
    steps: [
      '共享主机和远端电脑均需自行安装 Android Platform Tools。先在共享主机连接设备，并在设备上允许 USB 调试；ADBShare 不内置 adb。',
      '在本机 ADB 设置中确认服务可用，新建共享组，选择设备、局域网网卡、仅 IPv4 / 仅 IPv6 / 双协议、可用地址、独立端口和允许接入的来源 IP / 网段，然后保存并共享。',
      'Windows 根据提示配置防火墙规则；Linux 需要自行放行共享 TCP 端口并配置 USB / udev 权限，以普通用户运行。',
      '远端使用标准 adb 的 -H / -P 访问共享入口；无需对共享主机执行 adb connect，也无需把 USB 设备切换为网络调试。',
    ],
    examplesTitle: '远端命令示例',
    exampleHint:
      '将示例 IP、共享端口、SERIAL 和文件名替换为实际值。共享组的远端访问区提供当前配置对应的命令，可直接复制。',
    dailyTitle: '日常操作',
    daily: [
      '启动前会重新检查网卡、地址和协议的实际绑定能力，缺少所需协议地址时不能启动。IPv6 命令使用 -H "[地址]"；fe80:: 链路本地地址需要远端电脑自己的接口编号。本机上游 ADB 仍使用 IPv4 回环地址。',
      '每组可以独立启停。设备禁用会断开该设备的共享会话；停止组会断开该组全部共享会话。重新打开程序不会自动恢复共享。',
      '修改运行中的组前先停止共享；修改本机 ADB 服务端口前先停止全部组。本机可以继续直接使用原有 ADB Server。',
      '运行日志只保留本次运行的有界内存记录，交互数据是有上限的预览。需要保留时及时复制或保存；完整命令输出应由远端保存。',
      'Windows 停止共享保留规则，移除规则会先停止组；删除组和退出程序会清理规则。清理失败时按界面提示重试。',
    ],
    supportHint:
      '“适配”表示网关处理该协议并限制到共享组；设备服务的实际能力仍由客户端、上游 ADB 和设备决定。',
    commandTitle: '命令 / 能力',
    behaviorTitle: '支持情况与说明',
    commands: [
      [
        'devices [-l]、track-devices',
        '适配。仅返回当前组内已启用的设备，支持普通文本及 protobuf 二进制 / 文本设备跟踪；protobuf 需要上游版本支持。',
      ],
      [
        '-s / -t / -d / -e、默认选择',
        '适配。默认、USB 和网络 / 模拟器选择均在组内解析；多台符合条件的设备会返回歧义错误，请指定 -s SERIAL。',
      ],
      [
        'get-state、get-serialno、get-devpath、features',
        '适配。设备查询先在组内选择设备，再交给本机 ADB Server；不会用组外设备满足查询。',
      ],
      [
        'wait-for[-TRANSPORT]-STATE',
        '适配标准等待状态：device、recovery、rescue、sideload、bootloader、any、disconnect，支持状态组合。断开等待以设备 transport 消失为准，offline 不等于断开。',
      ],
      [
        'shell、exec-in/exec-out、logcat、push/pull、sync',
        '允许设备流透传。单条 shell 和重复执行 shell 不需要端口映射，也不会自动创建映射。',
      ],
      [
        'install / uninstall、bugreport、jdwp、root/unroot、reboot、remount、usb/tcpip、sideload',
        '允许对应设备服务透传，受设备权限、模式及上游能力限制。设备重启、切换调试模式可能中断所有使用该设备的连接。',
      ],
      [
        'server-status、mdns check、host-features',
        '提供共享主机上游 ADB 的只读诊断；不代表开放服务器管理权限。上游版本不支持时返回上游错误。',
      ],
      [
        'reconnect、reconnect device',
        '允许针对组内唯一确定的设备重连。会影响本机及其他使用者对同一设备的会话；不提供 reconnect offline 的全局重置。',
      ],
      [
        'forward / reverse',
        '不支持端口映射，包括创建、列表、删除和动态端口；依赖这些映射的调试或投屏流程无法通过本工具使用。',
      ],
      [
        'connect、disconnect、pair、kill-server、attach/detach、reconnect offline、mdns services',
        '不开放。设备连接、配对、USB 接管、全局管理及全网发现由共享主机管理。',
      ],
      [
        'help、version、keygen、pubkey、start-server',
        '前四项在远端客户端本地执行。start-server 对可用入口可仅检查版本后返回，不会通过 ADBShare 启动共享主机的上游服务。',
      ],
      [
        'emu、fastboot',
        '不提供共享主机模拟器控制台或 fastboot 代理。等待 bootloader 状态不等于 fastboot 共享。',
      ],
    ],
    validationHint:
      '协议回归和虚拟设备测试不能替代真机、多机局域网及所有 adb 版本的验证。IDE、投屏及安装的全部高级选项不作整体兼容承诺。',
    selectionTitle: '设备选择和隔离',
    selection: [
      '推荐使用 -s SERIAL；-t ID 是上游 ADB 的 transport id，设备重连后可能变化。-d 选择 USB，-e 选择网络设备或模拟器，两者仍仅限当前组。',
      '已经消失的 transport id 无法确认组归属，不能用于新建请求；需要跨重连等待时优先使用 -s SERIAL。',
      '不指定设备时要求组内只有一台符合条件的设备。等待命令可以等待组内设备出现；有多台符合条件时明确报错，不会随机挑选。',
      '同一设备可以被本机或其他组同时使用，程序没有独占租约。设备访问授权不是只读权限，也不是设备内部命令的细分权限控制。',
    ],
    boundaryTitle: '使用边界',
    boundaries: [
      '来源支持 IPv4 / CIDR（前缀 0–32）及 IPv6 / CIDR（前缀 0–128），每种监听协议至少配置一个来源，包括公网中转服务器。超出私有、回环及链路本地网段的范围会显示警告，但仍可保存和共享；0.0.0.0/0 会允许所有 IPv4 来源，::/0 会允许所有 IPv6 来源。',
      '当前没有账户认证或加密，来源 IP / 网段限制不能替代用户身份认证。公网或异地中转时，仅允许可信中转主机，并为中转链路配置访问控制与加密。',
      '来源白名单匹配 ADBShare 实际收到的 TCP 对端地址，不会自动恢复中转前的远端用户 IP。本机隧道若以回环地址接入，会按本机连接处理，需要在中转入口限制访问。',
      'Windows 自动防火墙规则适用于专用 / 域网络。公网来源地址不等于网卡的公用网络配置；请核对监听网卡的网络类型以及中转链路的放行规则。',
      '共享端和远端通常是不同电脑。共享 ADB 入口并不使两台电脑的 localhost、文件路径或端口成为同一资源。',
      '本工具不提供 forward/reverse，也不会根据 shell 内容猜测并建立隧道；放宽来源地址、修改防火墙或重新授权设备不会启用端口映射。',
      '服务器全局管理和全网发现不开放给远端，避免影响未共享设备或本机使用。server-status 显示的是上游服务器信息。',
    ],
    troubleTitle: '遇到问题时',
    troubleshooting: [
      '无法连接：检查共享主机的上游 ADB、组是否已启动、监听网卡、端口、防火墙和来源 IP / 网段。',
      '未显示设备：检查设备是否属于当前组且已启用，以及 USB 调试授权、连接状态和 Linux USB 权限。',
      '多设备歧义：先运行 devices -l，再加 -s SERIAL；不能通过 -d/-e 访问组外设备。',
      '提示不支持端口映射或主机管理命令：这是功能边界；请改用无需该能力的流程，或由共享主机执行相应管理。',
      '设备服务报错：检查当前设备模式、系统权限及两端 adb 版本。必要时导出组 / 设备日志，保留完整的远端命令和错误输出。',
    ],
  },
  en: {
    startTitle: 'Start sharing',
    steps: [
      'Install Android Platform Tools on the sharing host and remote computer. Connect the device on the sharing host and approve USB debugging. ADBShare does not bundle adb.',
      'Check the local ADB service in Settings. Create a group, select its devices, LAN adapter, IPv4-only / IPv6-only / dual mode, available addresses, unique port and allowed source IPs / subnets, then save and share.',
      'On Windows, approve firewall rule configuration when requested. On Linux, allow the sharing TCP port and configure USB / udev permissions yourself; run as a regular user.',
      'Use standard adb -H / -P on the remote computer. Do not adb connect to the sharing endpoint; USB devices do not need to switch to network debugging.',
    ],
    examplesTitle: 'Remote command examples',
    exampleHint:
      'Replace the IP, sharing port, SERIAL and file names. The Remote access card provides commands for your current group and lets you copy them.',
    dailyTitle: 'Daily use',
    daily: [
      'Startup rechecks the adapter, addresses and protocol bind capability. Missing required addresses prevent sharing. IPv6 commands use -H "[address]". Link-local fe80:: addresses require the remote computer’s own interface index. Local upstream ADB still uses IPv4 loopback.',
      'Groups start and stop independently. Disabling a device disconnects its shared sessions; stopping a group disconnects all its sessions. Restarting the app does not resume sharing automatically.',
      'Stop a group before editing it, and stop all groups before changing the local ADB server port. Local tools can continue using the original ADB Server directly.',
      'Logs are bounded, in-memory records for the current run. Payload previews are truncated. Copy or save records when needed; capture complete command output on the remote computer.',
      'On Windows, stopping sharing keeps its firewall rule. Removing a rule stops the group first. Deleting groups and exiting clean up rules; retry if cleanup fails.',
    ],
    supportHint:
      'Adapted protocols are restricted to the current group. Device service capabilities still depend on the client, upstream ADB and device.',
    commandTitle: 'Command / capability',
    behaviorTitle: 'Support and behavior',
    commands: [
      [
        'devices [-l], track-devices',
        'Adapted. Lists only enabled devices in this group. Plain text and binary / text protobuf device tracking are supported; protobuf requires upstream support.',
      ],
      [
        '-s / -t / -d / -e, default selection',
        'Adapted. Default, USB and network / emulator selection are resolved within the group. Multiple matching devices produce an ambiguity error; specify -s SERIAL.',
      ],
      [
        'get-state, get-serialno, get-devpath, features',
        'Adapted. Resolves a device within the group before querying the local ADB Server; devices outside the group cannot satisfy a query.',
      ],
      [
        'wait-for[-TRANSPORT]-STATE',
        'Adapts device, recovery, rescue, sideload, bootloader, any and disconnect, including state combinations. Disconnect waits for the transport to disappear; offline is not disconnected.',
      ],
      [
        'shell, exec-in/exec-out, logcat, push/pull, sync',
        'Device streams are relayed. Single or repeated shell commands do not need port mapping and do not create mappings automatically.',
      ],
      [
        'install / uninstall, bugreport, jdwp, root/unroot, reboot, remount, usb/tcpip, sideload',
        'Corresponding device services are relayed, subject to device permissions, mode and upstream support. Restarting a device or changing its debugging mode can interrupt everyone using that device.',
      ],
      [
        'server-status, mdns check, host-features',
        "Read-only diagnostics from the sharing host's upstream ADB. This does not grant server management access. Unsupported upstream versions return their own error.",
      ],
      [
        'reconnect, reconnect device',
        'Allowed after resolving a unique device within the group. This affects local and other users of that same device. Global reconnect offline is not provided.',
      ],
      [
        'forward / reverse',
        'Port mapping is not supported, including creating, listing, removing and dynamic ports. Debugging or screen-mirroring flows requiring these mappings cannot use this gateway.',
      ],
      [
        'connect, disconnect, pair, kill-server, attach/detach, reconnect offline, mdns services',
        'Not exposed. The sharing host manages device connections, pairing, USB ownership, global administration and network-wide discovery.',
      ],
      [
        'help, version, keygen, pubkey, start-server',
        "The first four run locally in the remote client. For an available endpoint, start-server can return after checking its version; it does not start the sharing host's upstream ADB through ADBShare.",
      ],
      [
        'emu, fastboot',
        "The sharing host's emulator console and fastboot are not proxied. Waiting for bootloader state does not provide fastboot sharing.",
      ],
    ],
    validationHint:
      'Protocol regressions and synthetic devices do not replace real hardware, multi-machine LAN or every adb version. Complete IDE, screen-mirroring and advanced installation workflows are not guaranteed.',
    selectionTitle: 'Device selection and isolation',
    selection: [
      'Prefer -s SERIAL. -t ID is the upstream ADB transport id and may change after reconnection. -d selects USB; -e selects network devices or emulators, always within the group.',
      'A disappeared transport id cannot be authorized for a new request. Prefer -s SERIAL when waiting across reconnections.',
      'Without a selector, exactly one matching device is required. Wait commands can wait for a group device to appear. Multiple matches report an error instead of selecting a device arbitrarily.',
      'A device may also be used locally or by other groups. There is no exclusive lease. Device access is not read-only and does not provide individual command permissions inside the device.',
    ],
    boundaryTitle: 'Usage boundaries',
    boundaries: [
      'Sources accept IPv4 / CIDR (prefix 0–32) and IPv6 / CIDR (prefix 0–128). Configure at least one source per listening protocol, including public relay servers. Ranges outside private, loopback and link-local blocks display a warning but can still be saved and shared. 0.0.0.0/0 allows all IPv4 sources; ::/0 allows all IPv6 sources.',
      'There is no account authentication or encryption; source restrictions are not user authentication. For public or cross-site relays, allow only trusted relay hosts and protect the relay connection with access control and encryption.',
      'The source list matches the TCP peer address actually received by ADBShare. It does not recover the original user IP before a relay. A local tunnel connecting through loopback is treated as a local connection, so restrict access at the relay entry point.',
      "Automatic Windows firewall rules apply to Private / Domain networks. A public source IP is different from the adapter's Public network profile; check the listening adapter profile and relay firewall rules.",
      'The sharing host and remote client are usually different computers. Sharing an ADB endpoint does not merge their localhost addresses, file paths or ports.',
      'ADBShare does not provide forward/reverse or infer tunnels from shell commands. Changing source ranges, firewall rules or device authorization does not enable port mapping.',
      'Global server administration and network-wide discovery are not exposed to remote clients, to protect unshared devices and local use. server-status describes the upstream server.',
    ],
    troubleTitle: 'Troubleshooting',
    troubleshooting: [
      'Cannot connect: check upstream ADB, group status, listening adapter, port, firewall and allowed source IPs / subnets.',
      'Missing device: check group membership, enabled state, USB debugging authorization, connection status and Linux USB permissions.',
      'Ambiguous selection: run devices -l, then specify -s SERIAL. -d/-e cannot access devices outside the group.',
      'Unsupported port mapping or host management: this is a feature boundary. Use a workflow that does not require it, or perform management on the sharing host.',
      'Device service error: check device mode, system permissions and adb versions. Save group / device logs and keep the complete remote command and error output.',
    ],
  },
};
