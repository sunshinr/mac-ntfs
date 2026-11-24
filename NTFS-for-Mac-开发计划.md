# NTFS for Mac 开发计划

> 目标：基于 macFUSE 自研 NTFS 读写管理工具，覆盖 macOS 12–27（Intel / Apple Silicon）
> 版本：v1.0
> 日期：2026-11-24

---

## 1. 范围与原则

| 项 | 内容 |
|---|---|
| 目标 | NTFS 读写管理工具：自动挂载 + 状态可视化 + 诊断，兼容 macOS 12–27 |
| 核心依赖 | macFUSE 5.x + ntfs-3g（用户态引擎），**不写自己的 kext** |
| 不做 | 不替换 `/sbin/mount_ntfs`、不关 SIP、不做 NTFS 修复/格式化（V1） |
| 分发 | macFUSE 作为外部依赖引导安装；禁止内嵌其闭源 kext |

## 2. 架构选型

| 层 | 技术 | 职责 |
|---|---|---|
| UI | Electron + Vue3 + TS + Element Plus + pnpm | 磁盘列表、挂载开关、状态、日志、权限引导 |
| 特权桥接 | Swift helper + SMJobBless LaunchDaemon | root 权限执行挂载/卸载，与 UI 走 XPC / 本地 socket |
| 事件监听 | Disk Arbitration C API (`DARegisterDiskAppearedCallback`) | 插盘自动触发重挂载 |
| 文件系统 | macFUSE 5.x（libfuse2）+ ntfs-3g | 实际 NTFS 读写 |
| 打包签名 | electron-builder + Developer ID + 公证 | 分发 |

数据通路：

```
Finder / 应用读写
    ↓
macOS VFS
    ↓
macFUSE（kext 或 FSKit backend）
    ↓
ntfs-3g 引擎（用户态，需串行化）
    ↓
NTFS 卷（块设备）
```

## 3. 兼容矩阵

| macOS | macFUSE 后端 | kext 批准 | 自动挂载方式 |
|---|---|---|---|
| 12–15.3 | kernel extension | 需用户批准；Apple Silicon 需降启动安全策略 | Disk Arbitration 卸载后重挂 |
| 15.4–25 | kernel extension | 同上 | 同上 |
| 26–27 | FSKit backend（可选） | 免 kext | 系统挂载流程接管，仍需实测确认 |

> 26+ 的 FSKit 后端需在 M3 阶段实测；不能假设与 kext 后端行为一致。

## 4. 里程碑

| 阶段 | 目标 | 关键任务 | 交付物 | 验收标准 |
|---|---|---|---|---|
| M0 | 技术验证 | 装 macFUSE + ntfs-3g；命令行跑通挂载 → 写入 → Windows 读回 | PoC 脚本 + 验证报告 | 真实盘写入成功，Windows 可见 |
| M1 | 挂载引擎 | Swift helper 封装挂载/卸载/状态查询；Node 桥接；特权助手 | CLI 工具 + API 文档 | UI 外可独立完成一次完整挂载 |
| M2 | UI 主体 | 磁盘列表、挂载开关、实时状态、日志面板 | Electron 应用可运行版 | 插盘 → 点击 → 可写，状态正确刷新 |
| M3 | 自动挂载 + 权限引导 | Disk Arbitration 监听；kext 批准引导页；26+ FSKit 分支 | 完整功能版 | 插盘自动挂载；权限缺失时给出明确指引 |
| M4 | 稳定性加固 | 测试矩阵；休眠卷检测；异常拔插；重启后重挂；串行化 ntfs-3g 调用 | 加固版 + 测试报告 | 测试矩阵全通过，无数据损坏 |
| M5 | 分发 | 签名、公证、DMG、安装引导、免责声明 | 可发布安装包 | Gatekeeper 无警告，清洁机可安装 |

## 5. 关键实现要点

### 5.1 PoC 命令（M0 基线）

```bash
brew install --cask macfuse
brew install gromgit/fuse/ntfs-3g-mac
diskutil info /dev/disk4s1 | grep -i file
sudo diskutil unmount /dev/disk4s1
sudo mkdir -p /Volumes/NTFS
sudo $(brew --prefix)/bin/ntfs-3g /dev/disk4s1 /Volumes/NTFS -o local,allow_other
```

### 5.2 工程约束

1. **线程安全**：ntfs-3g 非线程安全，所有引擎调用必须串行化（单队列）。
2. **休眠卷**：Windows 快速启动/休眠锁定的卷必须检测并保持只读，禁止强挂。
3. **重复挂载**：同一卷被 Apple 原生 NTFS 先挂载时，先 `diskutil unmount` 再挂，不要双重挂载。
4. **GPL 合规**：ntfs-3g 为 GPLv2。若静态链接，自身代码需开源；建议动态链接 + 独立分发，M5 前确认合规方案。
5. **错误码映射**：把挂载失败按「权限未批准 / 卷忙 / 休眠锁定 / 引擎缺失」分类，UI 给出对应操作指引。
6. **路径差异**：Intel `/usr/local`、Apple Silicon `/opt/homebrew`，一律用 `brew --prefix` 取路径。

## 6. 测试矩阵

| 维度 | 覆盖项 |
|---|---|
| 系统 | 12 / 13 / 14 / 15 / 26 / 27 |
| 芯片 | Intel / M1–M4 |
| 介质 | USB SSD、HDD、SD 卡、磁盘映像 |
| 场景 | 单大文件、海量小文件、休眠唤醒后重挂、异常拔插、重启后自动挂载、Windows 双向互读 |

## 7. 风险与规避

| 风险 | 规避 |
|---|---|
| 数据损坏 | 全程用闲置盘测试；写操作前提示备份；只读优先 |
| kext 被系统更新拒载 | 启动时自检后端状态，引导用户重新批准 |
| Apple 公证被拒 | 避免文件系统内核扩展关键词；提前用小版本试公证 |
| 性能差 | 明确告知用户态上限；不承诺接近原生速度 |
| Homebrew 路径差异 | 一律用 `brew --prefix`，不硬编码 |
| GPL 合规 | 动态链接；M5 前完成许可证审查 |

## 8. 下一步

先执行 M0，用闲置盘跑通命令行挂载。这是整个计划唯一的硬门槛——过了再投入 UI 开发。
