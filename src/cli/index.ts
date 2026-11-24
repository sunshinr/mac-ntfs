#!/usr/bin/env node
/**
 * M1 交付物：独立 CLI，复用与 UI 完全相同的服务层。
 *
 *   npm run cli -- status
 *   npm run cli -- list
 *   npm run cli -- mount /dev/disk4s1 [--read-only]
 *   npm run cli -- unmount /dev/disk4s1 [--force]
 *   npm run cli -- doctor
 */
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { BackendStatus, Settings, VolumeInfo } from '../shared/types'
import { DiskService } from '../main/services/disks'
import { MountEngine } from '../main/services/engine'
import { Logger } from '../main/services/logger'
import { PlatformService } from '../main/services/platform'
import { PrivilegedService } from '../main/services/privileged'
import { DEFAULT_SETTINGS } from '../main/services/settings'
import { buildDiagnostics } from '../main/services/diagnostics'
import { formatBytes } from './format'

interface CliOptions {
  command: string
  target?: string
  readOnly: boolean
  force: boolean
}

function parseArgs(argv: string[]): CliOptions {
  const args = [...argv]
  const command = (args.shift() ?? 'help').toLowerCase()
  const readOnly = args.includes('--read-only') || args.includes('-r')
  const force = args.includes('--force') || args.includes('-f')
  const target = args.find((arg) => !arg.startsWith('-'))
  return { command, target, readOnly, force }
}

function resolveLogDir(): string {
  if (process.env.NTFS4MAC_LOG_DIR) return process.env.NTFS4MAC_LOG_DIR
  return process.platform === 'darwin'
    ? join(homedir(), 'Library', 'Logs', 'NTFS4Mac')
    : join(homedir(), '.ntfs4mac', 'logs')
}

function printStatus(status: BackendStatus): void {
  const helper =
    status.helper.mode === 'helper'
      ? 'LaunchDaemon（免密）'
      : status.helper.mode === 'osascript'
        ? '管理员授权弹窗'
        : '演示模式'

  console.log('环境状态')
  console.log(`  系统        ${status.osName} ${status.osVersion}（${status.arch}）`)
  console.log(`  芯片        ${status.chip}`)
  console.log(`  后端        ${status.backend}`)
  console.log(
    `  macFUSE     ${status.macfuse.installed ? `已安装 v${status.macfuse.version ?? '未知'}` : '未安装'}${
      status.macfuse.kextLoaded ? '（kext 已加载）' : ''
    }`
  )
  console.log(
    `  ntfs-3g     ${status.ntfs3g.installed ? `${status.ntfs3g.version ?? '已安装'} @ ${status.ntfs3g.path}` : '未安装'}`
  )
  console.log(`  特权方式    ${helper}`)
  console.log(`  Homebrew    ${status.brewPrefix ?? '未找到'}`)
  console.log(
    `  SIP         ${status.sipEnabled === null ? '未检测' : status.sipEnabled ? '已开启' : '已关闭（不推荐）'}`
  )

  if (status.issues.length > 0) {
    console.log('\n待处理问题')
    for (const issue of status.issues) {
      console.log(`  - ${issue.title}：${issue.hint}`)
    }
  }
}

function volumeState(volume: VolumeInfo): string {
  if (!volume.mounted) return '未挂载'
  if (volume.writable) return '可读写'
  return volume.owner === 'ntfs4mac' ? '只读挂载' : '系统只读'
}

function printVolumes(volumes: VolumeInfo[]): void {
  if (volumes.length === 0) {
    console.log('未发现 NTFS 卷。连接磁盘后可重试，或用 diskutil list 检查分区类型。')
    return
  }

  const header = ['设备', '卷名', '容量', '状态', '挂载点']
  const rows = volumes.map((volume) => [
    volume.device,
    volume.name,
    formatBytes(volume.size),
    volumeState(volume),
    volume.mountPoint ?? '-'
  ])

  const widths = header.map((title, index) =>
    Math.max(title.length * 2, ...rows.map((row) => displayWidth(row[index])))
  )

  const formatRow = (row: string[]): string =>
    row.map((cell, index) => cell + ' '.repeat(Math.max(0, widths[index] - displayWidth(cell)))).join('  ')

  console.log(formatRow(header))
  console.log(widths.map((width) => '-'.repeat(width)).join('  '))
  for (const row of rows) console.log(formatRow(row))
}

/** 粗略计算终端显示宽度：CJK 字符按 2 个宽度计。 */
function displayWidth(text: string): number {
  let width = 0
  for (const char of text) {
    width += /[\u1100-\u115F\u2E80-\uA4CF\uAC00-\uD7A3\uF900-\uFAFF\uFE30-\uFE6F\uFF00-\uFF60\uFFE0-\uFFE6]/.test(
      char
    )
      ? 2
      : 1
  }
  return width
}

async function main(): Promise<number> {
  const options = parseArgs(process.argv.slice(2))
  const logger = new Logger(resolveLogDir())
  const platform = new PlatformService(logger)
  const disks = new DiskService(platform.mock, logger)
  const privileged = new PrivilegedService(platform.isMac, platform.mock, logger)
  const engine = new MountEngine(disks, privileged, logger, platform.mock)
  const settings: Settings = { ...DEFAULT_SETTINGS }

  if (options.command === 'help' || options.command === '--help' || options.command === '-h') {
    console.log(`NTFS for Mac CLI

用法：
  npm run cli -- status              环境与依赖状态
  npm run cli -- list                列出 NTFS 卷
  npm run cli -- mount <设备|卷名>   挂载（默认按设置读写，可加 --read-only）
  npm run cli -- unmount <设备|卷名> 卸载（可加 --force）
  npm run cli -- doctor              运行自检

说明：CLI 与图形界面共用同一套服务层与特权通道，非 macOS 环境为演示模式。`)
    return 0
  }

  const helper = await privileged.probe()
  const status = await platform.getStatus(helper)

  if (options.command === 'status') {
    printStatus(status)
    return status.issues.some((issue) => issue.code !== 'NOT_MACOS' && issue.actionable) ? 1 : 0
  }

  if (options.command === 'doctor') {
    const report = await buildDiagnostics(status, logger)
    printStatus(status)
    console.log('\n自检结果')
    for (const check of report.checks) {
      const mark = check.level === 'pass' ? '✓' : check.level === 'warn' ? '!' : '✗'
      console.log(`  ${mark} ${check.title}：${check.detail}`)
      if (check.hint) console.log(`      → ${check.hint}`)
    }
    console.log(
      `\n汇总：通过 ${report.summary.pass} / 警告 ${report.summary.warn} / 失败 ${report.summary.fail}`
    )
    return report.summary.fail > 0 ? 1 : 0
  }

  const volumes = await disks.listVolumes(true)

  if (options.command === 'list') {
    printVolumes(volumes)
    return 0
  }

  if (options.command === 'mount' || options.command === 'unmount') {
    if (!options.target) {
      console.error(`请指定设备或卷名，例如：npm run cli -- ${options.command} /dev/disk4s1`)
      return 2
    }

    const volume = volumes.find(
      (item) =>
        item.id === options.target ||
        item.device === options.target ||
        item.name === options.target ||
        item.mountPoint === options.target
    )
    if (!volume) {
      console.error(`未找到卷：${options.target}`)
      return 2
    }

    if (options.command === 'mount') {
      const result = await engine.mount(volume.id, { readOnly: options.readOnly }, status, {
        ...settings,
        readOnlyByDefault: options.readOnly
      })
      if (!result.ok) {
        console.error(`挂载失败：${result.message ?? '未知错误'}`)
        if (result.hint) console.error(`提示：${result.hint}`)
        if (result.logPath) console.error(`日志：${result.logPath}`)
        return 1
      }
      console.log(`✓ ${volume.name} → ${result.mountPoint}（${result.message ?? '挂载成功'}）`)
      return 0
    }

    const result = await engine.unmount(volume.id, options.force, status)
    if (!result.ok) {
      console.error(`卸载失败：${result.message ?? '未知错误'}`)
      if (result.hint) console.error(`提示：${result.hint}`)
      return 1
    }
    console.log(`✓ ${volume.name} ${result.message ?? '已卸载'}`)
    return 0
  }

  console.error(`未知命令：${options.command}，运行 npm run cli -- help 查看用法`)
  return 2
}

main()
  .then((code) => {
    process.exitCode = code
  })
  .catch((error: unknown) => {
    console.error('执行失败：', error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  })
