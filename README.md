# NTFS for Mac

基于 **macFUSE + ntfs-3g** 的 NTFS 读写管理工具：插盘自动挂载、挂载状态可视化、环境自检与权限引导。
不替换 `/sbin/mount_ntfs`，不关闭 SIP，不做 NTFS 修复/格式化。

> 支持目标：macOS 12–27（Intel / Apple Silicon）
> 当前版本：v0.1.0

---

## 功能

| 能力 | 实现位置 | 状态 |
|---|---|---|
| 磁盘枚举与 NTFS 识别 | `src/main/services/disks.ts` | 完成 |
| 读写 / 只读挂载、卸载、强制卸载 | `src/main/services/engine.ts` | 完成 |
| ntfs-3g 调用串行化（非线程安全） | `MountEngine` 单队列 | 完成 |
| 休眠 / 快速启动锁定保护（拒绝强挂） | 错误码映射 + `HIBERNATED` 指引 | 完成 |
| 系统只读挂载先卸载再重挂 | `unmountInternal` 前置调用 | 完成 |
| 特权执行（LaunchDaemon / 管理员弹窗兜底） | `src/main/services/privileged.ts`、`helper/` | 完成 |
| Disk Arbitration 插盘事件监听 | `helper/dar-monitor` + 轮询兜底 | 完成 |
| 插盘自动挂载、启动时自动重挂 | `AppController.autoMount` | 完成 |
| 实时状态、日志面板、环境自检 | `src/renderer/src/components/*` | 完成 |
| 独立 CLI（status / list / mount / unmount / doctor） | `src/cli/index.ts` | 完成 |
| kext 授权 / FSKit / 依赖安装引导 | `GuideDialog.vue` | 完成 |
| 签名、公证、DMG 配置 | `electron-builder.yml`、`docs/发布检查清单.md` | 配置就绪，待真机执行 |
| 真机测试矩阵 | `docs/测试矩阵.md` | 待真机执行 |

## 架构

```
Vue3 + Element Plus（渲染层）
        ↑ IPC（contextBridge，仅暴露白名单方法）
Electron 主进程
  ├─ DiskService      diskutil -plist → JSON
  ├─ MountEngine      ntfs-3g 调用串行队列 + 错误码映射
  ├─ PrivilegedService UNIX socket / osascript 兜底
  └─ VolumeWatcher    Disk Arbitration（dar-monitor）或轮询
        ↓
root LaunchDaemon（NTFS4MacHelper，白名单 argv）
        ↓
macFUSE kext/FSKit → ntfs-3g → NTFS 卷
```

## 目录结构

```
src/main/            Electron 主进程（控制器、IPC、服务）
src/preload/         受限 IPC 桥
src/renderer/        Vue3 界面
src/shared/          主进程与界面共用的类型 / 通道常量
helper/dar-monitor/  Disk Arbitration 监听器（Swift）
helper/NTFS4MacHelper/ 特权助手（Swift，LaunchDaemon）
scripts/             依赖安装、环境自检、M0 PoC、helper 编译
docs/                API、M0 报告模板、测试矩阵、发布清单
```

## 开发（任意平台）

```bash
npm install
npm run dev
```

- 非 macOS（或设置 `NTFS4MAC_MOCK=1`）时自动进入**演示模式**：展示示例卷，挂载/卸载为模拟操作，不会执行任何系统命令。
- 类型检查：`npm run typecheck`
- 产物构建：`npm run build`（输出 `out/`）
- 渲染层调试日志：`NTFS4MAC_DEBUG=1 npm run dev`

### 独立 CLI（M1 交付物）

与图形界面共用同一套服务层和特权通道，可在 UI 之外完成完整挂载：

```bash
npm run cli -- status                  # 环境与依赖状态
npm run cli -- list                    # 列出 NTFS 卷
npm run cli -- mount /dev/disk4s1      # 挂载（加 --read-only 只读）
npm run cli -- unmount /dev/disk4s1    # 卸载（加 --force 强制）
npm run cli -- doctor                  # 运行自检
```

## macOS 真机使用

```bash
# 1. 安装依赖（macFUSE + ntfs-3g），完成后重启并允许系统扩展
bash scripts/install-deps.sh

# 2. 环境自检
bash scripts/verify-backend.sh

# 3. M0 基线：命令行挂载 → 写入 → Windows 读回（务必用闲置盘）
sudo bash scripts/m0-poc.sh /dev/disk4s1

# 4. 安装特权助手（可选，免去每次输入管理员密码）
sudo bash scripts/build-helper.sh --install

# 5. 启动应用
npm run dev
```

打包：

```bash
npm run dist:mac          # 需要 Developer ID 证书
```

## 安全与数据保护

- **不做休眠强挂**：检测到 Windows 休眠/快速启动锁定时返回 `HIBERNATED`，提示先完整关机。
- **不关闭 SIP**：应用只做只读环境探测。
- **特权最小化**：助手只接受白名单可执行文件（`ntfs-3g`、`diskutil`、`umount`、`mkdir`、`rmdir`），
  请求按 newline-delimited JSON 串行处理，不解析任意 shell 字符串；socket 仅允许控制台用户连接。
- **写入提示**：首次启动展示数据安全免责声明，可全局切换为只读挂载。
- **不完全可信**：用户态文件系统性能与稳定性低于原生驱动，请自行备份重要数据。

## GPL 合规

`ntfs-3g` 为 GPLv2。本项目**不静态链接**、不修改也不内嵌其源码，仅在运行时按需调用其可执行文件，
属独立进程调用；macFUSE 作为外部依赖由用户自行安装，不分发其闭源内核扩展。
M5 发布前仍需按 `docs/发布检查清单.md` 完成许可证复核。

## 文档

- [IPC 与特权助手协议](docs/API.md)
- [M0 验证报告](docs/M0-验证报告.md)
- [测试矩阵](docs/测试矩阵.md)
- [发布检查清单](docs/发布检查清单.md)
- [开发计划](NTFS-for-Mac-开发计划.md)
