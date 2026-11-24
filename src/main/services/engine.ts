import { existsSync, readdirSync } from 'node:fs'
import type {
  BackendStatus,
  ErrorCode,
  MountOptions,
  OperationResult,
  Settings,
  VolumeInfo
} from '../../shared/types'
import type { DiskService } from './disks'
import { mapFailure } from './errors'
import { sleep } from './exec'
import type { Logger } from './logger'
import { mockMount, mockUnmount } from './mock'
import type { PrivilegedService } from './privileged'

const MOUNT_WAIT_MS = 12_000
const MOUNT_POLL_MS = 350

/**
 * 挂载引擎。
 * 计划 5.2-1：ntfs-3g 非线程安全，所有引擎调用进入单一串行队列。
 * 计划 5.2-2：休眠锁定的卷不做 remove_hiberfile 强挂，直接返回 HIBERNATED。
 * 计划 5.2-3：系统已挂载时先 diskutil unmount，再挂载，避免双重挂载。
 */
export class MountEngine {
  private tail: Promise<unknown> = Promise.resolve()

  constructor(
    private readonly disks: DiskService,
    private readonly privileged: PrivilegedService,
    private readonly logger: Logger,
    private readonly mock: boolean
  ) {}

  private enqueue<T>(task: () => Promise<T>): Promise<T> {
    const next = this.tail.then(task, task)
    this.tail = next.then(
      () => undefined,
      () => undefined
    )
    return next
  }

  mount(
    volumeId: string,
    options: MountOptions,
    status: BackendStatus,
    settings: Settings
  ): Promise<OperationResult> {
    return this.enqueue(async () => {
      const readOnly = options.readOnly ?? settings.readOnlyByDefault

      if (this.mock || status.mock) {
        await sleep(900)
        const volume = mockMount(volumeId, readOnly)
        if (!volume) return failure('UNKNOWN', '未找到该卷，请刷新磁盘列表')
        this.logger.success('engine', `[模拟] 已挂载 ${volume.name} 到 ${volume.mountPoint}`)
        return {
          ok: true,
          volumeId,
          mountPoint: volume.mountPoint ?? undefined,
          message: '演示模式：已模拟挂载'
        }
      }

      const volume = await this.disks.getVolume(volumeId)
      if (!volume) return failure('UNKNOWN', '卷已断开，请重新刷新磁盘列表')
      if (!volume.isNTFS) return failure('NOT_NTFS', '该分区不是 NTFS，本工具不处理')
      if (!status.ntfs3g.installed || !status.ntfs3g.path) {
        return failure(
          'ENGINE_MISSING',
          '未找到 ntfs-3g 引擎',
          '执行 brew install gromgit/fuse/ntfs-3g-mac 后点击“重新检测”。'
        )
      }
      if (!status.macfuse.installed) {
        return failure(
          'FUSE_UNAVAILABLE',
          '未安装 macFUSE',
          '安装 macFUSE、允许其系统扩展并重启后重试。'
        )
      }
      if (status.macfuse.kextLoaded === false && status.backend === 'unknown') {
        return failure(
          'PERMISSION_DENIED',
          'macFUSE 系统扩展尚未批准',
          '在“系统设置 → 隐私与安全性”中允许 macFUSE，并按提示重启。'
        )
      }

      if (
        volume.mounted &&
        volume.owner === 'ntfs4mac' &&
        volume.mountPoint &&
        (readOnly || volume.writable) &&
        !options.force
      ) {
        return {
          ok: true,
          volumeId,
          mountPoint: volume.mountPoint,
          message: '该卷已由本工具挂载'
        }
      }

      if (volume.mounted) {
        const unmounted = await this.unmountInternal(volume, false)
        if (!unmounted.ok) {
          this.logger.error('engine', '挂载前卸载原有挂载失败', unmounted.message)
          return unmounted
        }
      }

      const mountPoint =
        volume.mountPoint && volume.owner === 'ntfs4mac' ? volume.mountPoint : this.planMountPoint(volume)
      const optionString = this.buildOptions(settings, readOnly)

      this.logger.info(
        'engine',
        `挂载 ${volume.device} → ${mountPoint}`,
        `${status.ntfs3g.path} -o ${optionString}`
      )

      const mkdir = await this.privileged.run(['/bin/mkdir', '-p', mountPoint], 10_000)
      if (!mkdir.ok) {
        return this.fromOutput(mkdir.stderr || mkdir.error, '无法创建挂载点')
      }

      const logPath = `${this.privileged.logDir}/mount-${volume.id}-${Date.now()}.log`
      const spawned = await this.privileged.spawnDetached(
        [status.ntfs3g.path, volume.device, mountPoint, '-o', optionString],
        logPath
      )

      if (!spawned.ok) {
        const mapped = mapFailure(spawned.message ?? '', '启动 ntfs-3g 失败')
        this.logger.error('engine', mapped.message, logPath)
        return { ok: false, code: mapped.code, message: mapped.message, hint: mapped.hint, logPath }
      }

      const deadline = Date.now() + MOUNT_WAIT_MS
      let entry: { mountPoint: string; options: string[] } | null = null

      while (Date.now() < deadline) {
        await sleep(MOUNT_POLL_MS)
        const table = await this.disks.getMountTable()
        const found = table.find((item) => item.device === volume.device)
        if (found) {
          entry = { mountPoint: found.mountPoint, options: found.options }
          break
        }
        if (spawned.pid && !(await this.privileged.isAlive(spawned.pid))) break
      }

      if (entry) {
        const fresh = await this.disks.getVolume(volumeId)
        const writable = fresh ? fresh.writable : !readOnly
        this.logger.success(
          'engine',
          `已挂载 ${volume.name}`,
          `${entry.mountPoint}（${writable ? '可读写' : '只读'}）`
        )
        return {
          ok: true,
          volumeId,
          mountPoint: entry.mountPoint,
          message: writable ? '挂载成功，可读写' : '挂载成功（只读）'
        }
      }

      const tail = await this.privileged.readLogTail(logPath)
      const mapped = mapFailure(tail || spawned.message || '', '挂载失败')
      this.logger.error('engine', mapped.message, tail.trim() || logPath)
      return {
        ok: false,
        code: mapped.code,
        message: mapped.message,
        hint: mapped.hint,
        logPath
      }
    })
  }

  unmount(volumeId: string, force: boolean, status: BackendStatus): Promise<OperationResult> {
    return this.enqueue(async () => {
      if (this.mock || status.mock) {
        await sleep(600)
        const volume = mockUnmount(volumeId)
        if (!volume) return failure('UNKNOWN', '未找到该卷')
        this.logger.success('engine', `[模拟] 已卸载 ${volume.name}`)
        return { ok: true, volumeId, message: '演示模式：已模拟卸载' }
      }

      const volume = await this.disks.getVolume(volumeId)
      if (!volume) return failure('UNKNOWN', '卷已断开，请重新刷新磁盘列表')
      if (!volume.mounted) return { ok: true, volumeId, message: '该卷当前未挂载' }

      return this.unmountInternal(volume, force)
    })
  }

  private async unmountInternal(volume: VolumeInfo, force: boolean): Promise<OperationResult> {
    const target = volume.mountPoint ?? volume.device
    this.logger.info('engine', `卸载 ${target}`, force ? '强制模式' : undefined)

    const primary = await this.privileged.run(
      ['/usr/sbin/diskutil', 'unmount', ...(force ? ['force'] : []), target],
      30_000
    )

    if (!primary.ok) {
      const fallback = await this.privileged.run(
        ['/sbin/umount', ...(force ? ['-f'] : []), target],
        30_000
      )
      if (!fallback.ok) {
        const mapped = mapFailure(
          `${primary.stderr} ${fallback.stderr} ${primary.error ?? ''}`,
          '卸载失败'
        )
        this.logger.error('engine', mapped.message, target)
        return { ok: false, code: mapped.code, message: mapped.message, hint: mapped.hint }
      }
    }

    await sleep(400)
    const after = await this.disks.getVolume(volume.id)
    if (after?.mounted) {
      this.logger.warn('engine', '卸载后卷仍处于挂载状态', target)
      return failure(
        'VOLUME_BUSY',
        '卷仍处于挂载状态',
        '可能有应用正在读写该卷，关闭后重试；也可使用强制卸载（存在数据风险）。'
      )
    }

    if (volume.owner === 'ntfs4mac' && volume.mountPoint?.startsWith('/Volumes/')) {
      // 仅删除空目录，残留数据目录不会被误删
      await this.privileged.run(['/bin/rmdir', volume.mountPoint], 5000)
    }

    this.logger.success('engine', `已卸载 ${volume.name}`, target)
    return { ok: true, volumeId: volume.id, message: '已安全卸载' }
  }

  private buildOptions(settings: Settings, readOnly: boolean): string {
    const options = ['local']
    if (settings.allowOther) options.push('allow_other')
    if (settings.autoXattr) options.push('auto_xattr')
    if (readOnly) options.push('ro')
    if (settings.extraOptions) {
      options.push(...settings.extraOptions.split(',').filter(Boolean))
    }
    return options.join(',')
  }

  private planMountPoint(volume: VolumeInfo): string {
    const base = volume.name.replace(/[/\\:*?"<>|]/g, '-').trim() || volume.id
    const primary = `/Volumes/${base}`

    if (!existsSync(primary)) return primary
    try {
      if (readdirSync(primary).length === 0) return primary
    } catch {
      /* 无法读取时走后缀方案 */
    }

    for (let index = 2; index < 50; index += 1) {
      const candidate = `/Volumes/${base} ${index}`
      if (!existsSync(candidate)) return candidate
    }
    return `/Volumes/${volume.id}`
  }

  private fromOutput(raw: string | undefined, fallbackMessage: string): OperationResult {
    const mapped = mapFailure(raw ?? '', fallbackMessage)
    this.logger.error('engine', mapped.message)
    return { ok: false, code: mapped.code, message: mapped.message, hint: mapped.hint }
  }
}

function failure(code: ErrorCode, message: string, hint?: string): OperationResult {
  return { ok: false, code, message, hint }
}
