import { existsSync, readFileSync } from 'node:fs'
import os from 'node:os'
import type {
  BackendIssue,
  BackendKind,
  BackendStatus,
  HelperStatus,
  MacFuseStatus,
  Ntfs3gStatus
} from '../../shared/types'
import { run } from './exec'
import { issueFromCode } from './errors'
import type { Logger } from './logger'

const MACFUSE_PATH = '/Library/Filesystems/macfuse.fs'

/**
 * 负责探测运行环境：macOS 版本、芯片、SIP、macFUSE/kext 状态、ntfs-3g 路径。
 * 计划 5.2-6：Homebrew 前缀一律动态获取，不硬编码。
 */
export class PlatformService {
  readonly isMac = process.platform === 'darwin'
  /** 非 macOS 或显式指定时进入演示模式 */
  readonly mock: boolean

  constructor(private readonly logger: Logger) {
    this.mock = process.env.NTFS4MAC_MOCK === '1' || !this.isMac
    if (!this.isMac) {
      this.logger.warn('platform', '当前系统不是 macOS，已启用演示模式（不会执行真实挂载）')
    }
  }

  async getStatus(helper: HelperStatus): Promise<BackendStatus> {
    if (this.mock) return this.mockStatus(helper)
    return this.detectReal(helper)
  }

  private async detectReal(helper: HelperStatus): Promise<BackendStatus> {
    const [swVers, uname, sip, cpu] = await Promise.all([
      run('/usr/bin/sw_vers', [], { timeoutMs: 8000 }),
      run('/usr/bin/uname', ['-m'], { timeoutMs: 5000 }),
      run('/usr/bin/csrutil', ['status'], { timeoutMs: 8000 }),
      run('/usr/sbin/sysctl', ['-n', 'machdep.cpu.brand_string'], { timeoutMs: 5000 })
    ])

    const osVersion = /ProductVersion:\s*([\d.]+)/.exec(swVers.stdout)?.[1] ?? ''
    const osName = /ProductName:\s*(.+)/.exec(swVers.stdout)?.[1]?.trim() ?? 'macOS'
    const arch = uname.stdout.trim() || process.arch
    const chip = cpu.stdout.trim() || os.cpus()[0]?.model || arch
    const sipEnabled = /enabled/.test(sip.stdout) ? true : /disabled/.test(sip.stdout) ? false : null

    const [brewPrefix, macfuse, ntfs3g] = await Promise.all([
      this.resolveBrewPrefix(),
      this.detectMacFuse(),
      this.resolveNtfs3g()
    ])

    const major = Number(osVersion.split('.')[0]) || 0
    const backend: BackendKind = macfuse.kextLoaded ? 'kext' : major >= 26 ? 'fskit' : 'unknown'

    return {
      platform: process.platform,
      isMac: true,
      mock: false,
      osVersion: osVersion || '未知',
      osName,
      arch,
      chip,
      sipEnabled,
      brewPrefix,
      backend,
      macfuse,
      ntfs3g,
      helper,
      issues: this.buildIssues(macfuse, ntfs3g, backend),
      checkedAt: Date.now()
    }
  }

  private mockStatus(helper: HelperStatus): BackendStatus {
    const issues: BackendIssue[] = []
    if (!this.isMac) {
      issues.push(
        issueFromCode(
          'NOT_MACOS',
          '当前为演示模式',
          '未检测到 macOS，界面展示示例卷信息，挂载 / 卸载均为模拟操作。',
          '在 macOS 12 及以上的真实设备上运行，才会连接 macFUSE 与 ntfs-3g。',
          false
        )
      )
    }

    return {
      platform: process.platform,
      isMac: this.isMac,
      mock: true,
      osVersion: this.isMac
        ? (process.env.NTFS4MAC_MOCK_OS ?? '15.4')
        : os.release() || process.platform,
      osName: this.isMac ? 'macOS' : process.platform === 'win32' ? 'Windows' : 'Linux',
      arch: process.arch,
      chip: os.cpus()[0]?.model ?? process.arch,
      sipEnabled: null,
      brewPrefix: '/opt/homebrew',
      backend: 'kext',
      macfuse: { installed: true, version: '5.0.6（模拟）', kextLoaded: true, path: MACFUSE_PATH },
      ntfs3g: { installed: true, path: '/opt/homebrew/bin/ntfs-3g', version: '2022.10.3（模拟）' },
      helper: { ...helper, connected: true, mode: 'mock', detail: '演示模式：不会执行真实特权命令' },
      issues,
      checkedAt: Date.now()
    }
  }

  private async resolveBrewPrefix(): Promise<string | null> {
    const envPrefix = process.env.HOMEBREW_PREFIX
    if (envPrefix && existsSync(`${envPrefix}/bin/brew`)) return envPrefix

    for (const prefix of ['/opt/homebrew', '/usr/local']) {
      if (existsSync(`${prefix}/bin/brew`)) return prefix
    }

    const which = await run('/usr/bin/which', ['brew'], { timeoutMs: 5000 })
    const brewPath = which.stdout.trim()
    if (!brewPath) return null

    const prefix = await run(brewPath, ['--prefix'], { timeoutMs: 8000 })
    return prefix.ok && prefix.stdout.trim() ? prefix.stdout.trim() : null
  }

  private async detectMacFuse(): Promise<MacFuseStatus> {
    const installed = existsSync(MACFUSE_PATH)
    let version: string | null = null

    if (installed) {
      try {
        const info = readFileSync(`${MACFUSE_PATH}/Contents/Info.plist`, 'utf8')
        version = /<key>CFBundleVersion<\/key>\s*<string>([^<]+)<\/string>/.exec(info)?.[1] ?? null
      } catch {
        version = null
      }
    }

    let kextLoaded = false
    const kmutil = await run('/usr/bin/kmutil', ['showloaded', '--list-only'], { timeoutMs: 10_000 })
    if (kmutil.ok) {
      kextLoaded = /macfuse|fuse/i.test(kmutil.stdout)
    }
    if (!kextLoaded) {
      const kextstat = await run('/usr/sbin/kextstat', [], { timeoutMs: 8000 })
      kextLoaded = /macfuse|fuse/i.test(kextstat.stdout)
    }

    return { installed, version, kextLoaded, path: MACFUSE_PATH }
  }

  private async resolveNtfs3g(): Promise<Ntfs3gStatus> {
    const brewPrefix = await this.resolveBrewPrefix()
    const candidates = [
      brewPrefix ? `${brewPrefix}/bin/ntfs-3g` : '',
      '/opt/homebrew/bin/ntfs-3g',
      '/usr/local/bin/ntfs-3g',
      '/opt/local/bin/ntfs-3g',
      '/usr/local/sbin/ntfs-3g'
    ].filter(Boolean)

    const path = candidates.find((candidate) => existsSync(candidate)) ?? null
    if (!path) return { installed: false, path: null, version: null }

    const versionResult = await run(path, ['--version'], { timeoutMs: 8000 })
    const raw = (versionResult.stdout || versionResult.stderr).split('\n').filter(Boolean)[0]
    return { installed: true, path, version: raw?.trim() ?? null }
  }

  private buildIssues(macfuse: MacFuseStatus, ntfs3g: Ntfs3gStatus, backend: BackendKind): BackendIssue[] {
    const issues: BackendIssue[] = []

    if (!macfuse.installed) {
      issues.push(
        issueFromCode(
          'FUSE_UNAVAILABLE',
          '未安装 macFUSE',
          '未检测到 /Library/Filesystems/macfuse.fs，用户态文件系统无法工作。',
          '执行 brew install --cask macfuse 安装并重启，然后在“系统设置 → 隐私与安全性”中允许其系统扩展。'
        )
      )
    } else if (!macfuse.kextLoaded && backend !== 'fskit') {
      issues.push(
        issueFromCode(
          'PERMISSION_DENIED',
          'macFUSE 系统扩展未获批准',
          'macFUSE 已安装，但内核扩展未加载，挂载将失败。',
          '打开“系统设置 → 隐私与安全性”，在安全性区域点击“允许”；Apple 芯片需关机后长按电源键进入恢复模式，把“降低安全性”设为允许用户管理内核扩展，再重启。'
        )
      )
    }

    if (!ntfs3g.installed) {
      issues.push(
        issueFromCode(
          'ENGINE_MISSING',
          '未安装 ntfs-3g 引擎',
          '在 Homebrew 前缀下未找到 ntfs-3g 可执行文件。',
          '执行 brew install gromgit/fuse/ntfs-3g-mac 安装用户态引擎，然后点击“重新检测”。'
        )
      )
    }

    if (backend === 'fskit') {
      issues.push(
        issueFromCode(
          'UNKNOWN',
          'macOS 26+ 使用 FSKit 后端',
          '当前系统未加载 macFUSE 内核扩展，将按 FSKit 后端处理，该路径仍需实测验证。',
          '若挂载失败，请确认 macFUSE 版本支持 FSKit，或在恢复模式允许内核扩展后使用 kext 后端。',
          false
        )
      )
    }

    return issues
  }
}
