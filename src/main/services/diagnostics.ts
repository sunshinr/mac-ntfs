import type { BackendStatus, DiagnosticCheck, DiagnosticReport } from '../../shared/types'
import { run } from './exec'
import type { Logger } from './logger'

/**
 * 自检报告：把“能不能挂载”拆成可逐项确认的检查，便于支持与排障。
 */
export async function buildDiagnostics(status: BackendStatus, logger: Logger): Promise<DiagnosticReport> {
  const checks: DiagnosticCheck[] = []
  const major = Number(status.osVersion.split('.')[0]) || 0

  checks.push({
    id: 'mode',
    title: '运行模式',
    level: status.mock ? 'warn' : 'pass',
    detail: status.mock ? '演示模式：未连接真实磁盘，挂载操作仅做模拟' : '真实模式：连接 macOS 磁盘子系统',
    hint: status.mock ? '在 macOS 12+ 设备上运行以使用真实挂载能力' : undefined
  })

  if (status.isMac) {
    const supported = major >= 12 && major <= 27
    checks.push({
      id: 'os',
      title: '系统版本',
      level: supported ? 'pass' : major > 27 ? 'warn' : 'fail',
      detail: `${status.osName} ${status.osVersion}（${status.chip} / ${status.arch}）`,
      hint: supported ? undefined : '计划支持 macOS 12–27，当前版本未经完整验证'
    })
  }

  checks.push({
    id: 'macfuse',
    title: 'macFUSE',
    level: status.macfuse.installed ? 'pass' : 'fail',
    detail: status.macfuse.installed
      ? `已安装${status.macfuse.version ? ` v${status.macfuse.version}` : ''}：${status.macfuse.path}`
      : '未检测到 /Library/Filesystems/macfuse.fs',
    hint: status.macfuse.installed ? undefined : '执行 brew install --cask macfuse 后重启'
  })

  checks.push({
    id: 'extension',
    title: '文件系统后端',
    level: status.macfuse.kextLoaded ? 'pass' : status.backend === 'fskit' ? 'warn' : 'fail',
    detail: status.macfuse.kextLoaded
      ? '内核扩展已加载（kext 后端）'
      : status.backend === 'fskit'
        ? '未加载 kext，按 FSKit 后端处理（需实测确认）'
        : '未检测到可用的 macFUSE 后端',
    hint:
      status.macfuse.kextLoaded || status.backend === 'fskit'
        ? undefined
        : '在“系统设置 → 隐私与安全性”允许 macFUSE 系统扩展；Apple 芯片需在恢复模式降低启动安全性'
  })

  checks.push({
    id: 'ntfs3g',
    title: 'ntfs-3g 引擎',
    level: status.ntfs3g.installed ? 'pass' : 'fail',
    detail: status.ntfs3g.installed
      ? `${status.ntfs3g.version ?? '版本未知'}：${status.ntfs3g.path}`
      : '未找到 ntfs-3g 可执行文件',
    hint: status.ntfs3g.installed
      ? undefined
      : '执行 brew install gromgit/fuse/ntfs-3g-mac 安装用户态引擎'
  })

  checks.push({
    id: 'helper',
    title: '特权助手',
    level: status.helper.mode === 'helper' ? 'pass' : status.helper.mode === 'osascript' ? 'warn' : 'warn',
    detail: status.helper.detail,
    hint:
      status.helper.mode === 'helper'
        ? undefined
        : '执行 sudo bash scripts/build-helper.sh --install 安装 LaunchDaemon，可避免重复输入密码'
  })

  checks.push({
    id: 'brew',
    title: 'Homebrew 前缀',
    level: status.brewPrefix ? 'pass' : 'warn',
    detail: status.brewPrefix ?? '未找到 brew，路径相关功能将不可用',
    hint: status.brewPrefix ? undefined : '安装 Homebrew 后重新检测；Intel 为 /usr/local，Apple 芯片为 /opt/homebrew'
  })

  if (status.isMac && !status.mock) {
    const diskutil = await run('/usr/sbin/diskutil', ['list'], { timeoutMs: 10_000 })
    checks.push({
      id: 'diskutil',
      title: 'diskutil 可用性',
      level: diskutil.ok ? 'pass' : 'fail',
      detail: diskutil.ok ? '可正常枚举磁盘' : diskutil.stderr.trim() || 'diskutil 调用失败',
      hint: diskutil.ok ? undefined : '确认系统磁盘工具可用，或重启后重试'
    })
  }

  checks.push({
    id: 'sip',
    title: '系统完整性保护（SIP）',
    level: 'pass',
    detail:
      status.sipEnabled === null
        ? '未检测（演示模式）'
        : status.sipEnabled
          ? '已开启（符合预期，本工具不要求关闭 SIP）'
          : '已关闭（不推荐，建议重新开启）',
    hint: status.sipEnabled === false ? '本工具无需关闭 SIP，开启后仍可正常工作' : undefined
  })

  const summary = { pass: 0, warn: 0, fail: 0 }
  for (const check of checks) summary[check.level] += 1

  if (summary.fail > 0) {
    logger.warn('diagnostics', '自检发现阻塞项', `失败 ${summary.fail} / 警告 ${summary.warn}`)
  } else {
    logger.debug('diagnostics', '自检完成', `通过 ${summary.pass} / 警告 ${summary.warn}`)
  }
  return { checks, generatedAt: Date.now(), summary }
}
