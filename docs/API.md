# API 与协议

本文描述三层接口：渲染层 ↔ 主进程（IPC）、主进程 ↔ 特权助手（UNIX socket）、主进程 ↔ 系统命令。

## 1. 渲染层 IPC

预加载脚本通过 `contextBridge` 暴露 `window.api`，不暴露 `ipcRenderer` 本体。

| 方法 | 通道 | 参数 | 返回 |
|---|---|---|---|
| `getState()` | `app:get-state` | — | `AppState` |
| `refresh()` | `app:refresh` | — | `AppState` |
| `mount(volumeId, options?)` | `volume:mount` | `MountOptions` | `OperationResult` |
| `unmount(volumeId, force?)` | `volume:unmount` | `boolean` | `OperationResult` |
| `diagnose()` | `app:diagnose` | — | `DiagnosticReport` |
| `saveSettings(patch)` | `settings:save` | `Partial<Settings>` | `Settings` |
| `getLogs()` | `log:get` | — | `LogEntry[]` |
| `clearLogs()` | `log:clear` | — | `void` |
| `openLogDir()` | `log:open-dir` | — | `void` |
| `revealPath(path)` | `shell:reveal` | 绝对路径 | `void` |
| `openExternal(url)` | `shell:open-external` | 仅 http(s) | `void` |
| `openSecuritySettings()` | `shell:open-security-settings` | — | `void` |

主进程推送：

| 事件 | 通道 | 载荷 |
|---|---|---|
| 状态变更 | `event:state` | `AppState` |
| 新增日志 | `event:log` | `LogEntry` |
| 操作提示 | `event:toast` | `ToastPayload` |

`onState` / `onLog` / `onToast` 均返回取消订阅函数。

### AppState

```ts
interface AppState {
  appVersion: string
  status: BackendStatus      // 系统、macFUSE、ntfs-3g、helper、issues
  volumes: VolumeInfo[]
  settings: Settings
  diagnostics: DiagnosticReport | null
  busy: Record<string, boolean>
  refreshing: boolean
  lastRefresh: number
  engineReady: boolean
  logFile: string
}
```

### VolumeInfo 关键字段

| 字段 | 说明 |
|---|---|
| `id` / `device` | `disk4s1` / `/dev/disk4s1` |
| `fsType` | 挂载表文件系统类型，macFUSE 挂载时为 `macfuse` |
| `owner` | `none` / `system` / `ntfs4mac` |
| `mounted` / `readOnly` / `writable` | 当前挂载状态；系统 NTFS 挂载恒为只读 |

### 挂载参数

主进程生成 `-o` 选项，不接受任意字符串：

```
local[,allow_other][,auto_xattr][,ro][,<白名单内的附加参数>]
```

附加参数需匹配 `^[a-z0-9_]+(=[a-zA-Z0-9_:.-]+)?$`，最多 8 项，保存设置时即校验。

## 2. 特权助手协议

- socket：`/var/run/ntfs4mac/helper.sock`（mode 0666，连接后校验 `getpeereid` 是否为 `/dev/console` 属主）
- 传输：newline-delimited JSON，单请求单响应
- 请求串行执行（`workQueue`），避免并发挂载同一卷
- 可执行文件白名单：`ntfs-3g`（Intel/Apple 芯片路径）、`diskutil`、`umount`、`mkdir`、`rmdir`

### 请求 / 响应

```jsonc
// 存活探测
{"id":"1","action":"ping"}
{"id":"1","ok":true,"version":"1.0.0","pid":1234}

// 短命令（同步返回）
{"id":"2","action":"run","argv":["/usr/sbin/diskutil","unmount","/dev/disk4s1"],"timeoutMs":15000}
{"id":"2","ok":true,"code":0,"stdout":"","stderr":""}

// 常驻进程（ntfs-3g 挂载后为前台守护）
{"id":"3","action":"spawn","argv":["/opt/homebrew/bin/ntfs-3g","/dev/disk4s1","/Volumes/DATA","-o","local,allow_other"],"logPath":"/var/log/ntfs4mac/mount-disk4s1-1.log","startupWaitMs":1200}
{"id":"3","ok":true,"pid":5678,"alive":true}
```

`spawn` 在 `startupWaitMs` 内退出时返回 `alive:false` 与退出码，主进程据此读取日志尾部做错误映射。

未安装助手时的兜底：`osascript -e 'do shell script "..." with administrator privileges'`，
挂载进程以 `nohup ... >> <log> 2>&1 &` 后台执行，主进程轮询挂载表确认结果。

## 3. 错误码

| 错误码 | 触发场景 | UI 指引 |
|---|---|---|
| `PERMISSION_DENIED` | 授权取消、非 root、系统扩展未批准 | 重新授权 / kext 批准引导 |
| `VOLUME_BUSY` | 卷被占用、卸载后仍挂载 | 关闭占用应用，可确认后强制卸载 |
| `HIBERNATED` | Windows 休眠 / 快速启动锁定 | 关闭快速启动并完整关机（不提供强挂） |
| `ENGINE_MISSING` | 未找到 ntfs-3g | `brew install gromgit/fuse/ntfs-3g-mac` |
| `FUSE_UNAVAILABLE` | 未安装 macFUSE / FUSE 设备不可用 | 安装 macFUSE 并允许系统扩展 |
| `NOT_NTFS` | 分区不是 NTFS | 仅提示，不处理 |
| `ALREADY_MOUNTED` | 卷已被挂载 | 先卸载再重试（引擎会自动处理） |
| `NOT_MACOS` | 非 macOS 演示模式 | 提示在 macOS 上运行 |
| `MOUNT_POINT_BLOCKED` | 挂载点不可用（保留） | 手动清理 `/Volumes` 下同名目录 |
| `TIMEOUT` | 命令或挂载等待超时 | 检查磁盘连接后重试 |
| `UNKNOWN` | 未匹配的错误，回显日志尾部 | 打开日志面板 / 复制环境信息 |

错误映射逻辑见 `src/main/services/errors.ts`。

## 4. dar-monitor 事件

标准输出 JSON Lines：

```json
{"event":"ready","version":"1.0.0","pid":900}
{"event":"appeared","device":"/dev/disk4s1","bsdName":"disk4s1","volumeName":"DATA","volumePath":"/Volumes/DATA","size":1000204886016,"removable":true}
{"event":"changed","device":"/dev/disk4s1","volumeName":"DATA"}
{"event":"disappeared","device":"/dev/disk4s1"}
```

主进程收到 `appeared` / `disappeared` / `changed` 后做 700ms 去抖，再触发一次全量刷新。
二进制缺失或异常退出时自动回退为 `diskutil list` 轮询（间隔可在设置中调整）。
