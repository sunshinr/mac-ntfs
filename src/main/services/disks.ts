import type { VolumeInfo, VolumeOwner } from '../../shared/types'
import { mapLimit, run, shellQuote } from './exec'
import { mockVolume, mockVolumes } from './mock'
import type { Logger } from './logger'

export interface MountEntry {
  device: string
  mountPoint: string
  fsType: string
  options: string[]
}

interface DiskInfo {
  DeviceIdentifier?: string
  DeviceNode?: string
  VolumeName?: string
  MountPoint?: string
  FilesystemType?: string
  FilesystemName?: string
  Content?: string
  Size?: number | string
  TotalSize?: number | string
  VolumeFreeSpace?: number | string
  RemovableMedia?: boolean
  Internal?: boolean
  SolidState?: boolean
  BusProtocol?: string
  MediaName?: string
  ParentWholeDisk?: string
  Mounted?: boolean
  ReadOnlyVolume?: boolean
}

const INFO_TIMEOUT = 15_000

/**
 * 磁盘枚举：diskutil -plist 经 plutil 转 JSON，避免额外 plist 解析依赖。
 * 权限/休眠/占用的判定交给 engine 的错误码映射。
 */
export class DiskService {
  constructor(
    private readonly mock: boolean,
    private readonly logger: Logger
  ) {}

  async listVolumes(includeNonNtfs: boolean): Promise<VolumeInfo[]> {
    if (this.mock) return mockVolumes(includeNonNtfs)

    const identifierList = await this.listDeviceIdentifiers()
    if (identifierList.length === 0) return []

    const table = await this.getMountTable()
    const volumes = await mapLimit(identifierList, 6, async (identifier) => {
      const info = await this.readInfo(identifier)
      return info ? this.toVolume(info, table) : null
    })

    return volumes
      .filter((volume): volume is VolumeInfo => volume !== null)
      .filter((volume) => includeNonNtfs || volume.isNTFS)
      .sort(compareVolumes)
  }

  async getVolume(identifier: string): Promise<VolumeInfo | null> {
    if (this.mock) return mockVolume(identifier)
    if (!/^[A-Za-z0-9._-]+$/.test(identifier)) return null

    const info = await this.readInfo(identifier)
    if (!info) return null
    const table = await this.getMountTable()
    return this.toVolume(info, table)
  }

  async getMountTable(): Promise<MountEntry[]> {
    if (this.mock) return []
    const result = await run('/sbin/mount', [], { timeoutMs: 8000 })
    if (!result.ok) {
      this.logger.warn('disks', '读取挂载表失败', result.stderr || result.error)
      return []
    }

    const entries: MountEntry[] = []
    for (const line of result.stdout.split('\n')) {
      const match = /^(\S+) on (.+) \(([^)]*)\)$/.exec(line.trim())
      if (!match) continue
      const options = match[3]
        .split(',')
        .map((option) => option.trim())
        .filter(Boolean)
      entries.push({ device: match[1], mountPoint: match[2].trim(), fsType: options[0] ?? '', options })
    }
    return entries
  }

  private async listDeviceIdentifiers(): Promise<string[]> {
    const script = '/usr/sbin/diskutil list -plist | /usr/bin/plutil -convert json -o - -'
    const result = await run('/bin/sh', ['-c', script], { timeoutMs: 15_000 })
    if (!result.ok || !result.stdout.trim()) {
      this.logger.error('disks', '读取磁盘列表失败', result.stderr || result.error)
      return []
    }

    try {
      const doc = JSON.parse(result.stdout) as {
        AllDisksAndPartitions?: Array<{
          DeviceIdentifier?: string
          Partitions?: Array<{ DeviceIdentifier?: string }>
          APFSVolumes?: Array<{ DeviceIdentifier?: string }>
        }>
      }

      const identifiers = new Set<string>()
      for (const disk of doc.AllDisksAndPartitions ?? []) {
        for (const partition of disk.Partitions ?? []) {
          if (partition.DeviceIdentifier) identifiers.add(partition.DeviceIdentifier)
        }
        for (const volume of disk.APFSVolumes ?? []) {
          if (volume.DeviceIdentifier) identifiers.add(volume.DeviceIdentifier)
        }
      }
      return [...identifiers]
    } catch (error) {
      this.logger.error('disks', '解析磁盘列表失败', String(error))
      return []
    }
  }

  private async readInfo(identifier: string): Promise<DiskInfo | null> {
    const script = `/usr/sbin/diskutil info -plist ${shellQuote(identifier)} | /usr/bin/plutil -convert json -o - -`
    const result = await run('/bin/sh', ['-c', script], { timeoutMs: INFO_TIMEOUT })
    if (!result.ok || !result.stdout.trim()) {
      this.logger.debug('disks', `读取 ${identifier} 信息失败`, result.stderr.trim())
      return null
    }
    try {
      return JSON.parse(result.stdout) as DiskInfo
    } catch (error) {
      this.logger.debug('disks', `解析 ${identifier} 信息失败`, String(error))
      return null
    }
  }

  private toVolume(info: DiskInfo, table: MountEntry[]): VolumeInfo {
    const identifier = String(info.DeviceIdentifier ?? '')
    const device = String(info.DeviceNode ?? `/${identifier ? `dev/${identifier}` : ''}`)
    const mountEntry = table.find((entry) => entry.device === device)
    const options = mountEntry?.options ?? []
    const fsType = mountEntry?.fsType || String(info.FilesystemType ?? info.Content ?? 'unknown')

    const isNTFS =
      /ntfs/i.test(String(info.Content ?? '')) ||
      /ntfs/i.test(String(info.FilesystemType ?? '')) ||
      /ntfs/i.test(String(info.FilesystemName ?? '')) ||
      /ntfs/i.test(fsType)

    const mounted = Boolean(info.Mounted) || Boolean(mountEntry)
    const readOnly =
      Boolean(info.ReadOnlyVolume) || options.includes('read-only') || options.includes('ro')

    let owner: VolumeOwner = 'none'
    if (mounted) {
      const fuseMounted = /fuse/i.test(fsType)
      const ours = fuseMounted || options.includes('allow_other') || options.includes('auto_xattr')
      owner = ours ? 'ntfs4mac' : 'system'
    }

    return {
      id: identifier || identifierFallback(device),
      device,
      name: String(info.VolumeName ?? info.MediaName ?? '未命名卷'),
      mountPoint: mountEntry?.mountPoint ?? (info.MountPoint ? String(info.MountPoint) : null),
      size: toNumber(info.Size ?? info.TotalSize),
      freeSpace: info.VolumeFreeSpace === undefined ? null : toNumber(info.VolumeFreeSpace),
      fsType,
      content: String(info.Content ?? ''),
      isNTFS,
      mounted,
      readOnly,
      writable: isNTFS && mounted && !readOnly,
      owner,
      removable: Boolean(info.RemovableMedia),
      internal: Boolean(info.Internal),
      solidState: Boolean(info.SolidState),
      bus: String(info.BusProtocol ?? ''),
      diskName: String(info.MediaName ?? info.ParentWholeDisk ?? identifier)
    }
  }
}

function toNumber(value: number | string | undefined): number {
  if (typeof value === 'number') return value
  if (typeof value === 'string') return Number(value) || 0
  return 0
}

function identifierFallback(device: string): string {
  return device.replace('/dev/', '') || device
}

function compareVolumes(a: VolumeInfo, b: VolumeInfo): number {
  const score = (volume: VolumeInfo): number => {
    if (volume.isNTFS && volume.mounted) return 0
    if (volume.isNTFS) return 1
    if (volume.mounted) return 2
    return 3
  }
  const diff = score(a) - score(b)
  return diff !== 0 ? diff : a.name.localeCompare(b.name, 'zh-Hans-CN')
}
