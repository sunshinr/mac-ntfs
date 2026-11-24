import type { VolumeInfo } from '../../shared/types'

/**
 * 非 macOS 环境（或 NTFS4MAC_MOCK=1）下的演示数据。
 * 仅用于 UI 开发与构建验证，不会接触真实磁盘。
 */
const GB = 1024 ** 3

const volumes: VolumeInfo[] = [
  {
    id: 'disk4s1',
    device: '/dev/disk4s1',
    name: 'WIN-BACKUP',
    mountPoint: null,
    size: 256 * GB,
    freeSpace: 96 * GB,
    fsType: 'ntfs',
    content: 'Windows_NTFS',
    isNTFS: true,
    mounted: false,
    readOnly: false,
    writable: false,
    owner: 'none',
    removable: true,
    internal: false,
    solidState: true,
    bus: 'USB',
    diskName: 'Samsung PSSD T7'
  },
  {
    id: 'disk5s2',
    device: '/dev/disk5s2',
    name: 'DATA',
    mountPoint: '/Volumes/DATA',
    size: 1 * 1024 * GB,
    freeSpace: 320 * GB,
    fsType: 'ntfs',
    content: 'Windows_NTFS',
    isNTFS: true,
    mounted: true,
    readOnly: true,
    writable: false,
    owner: 'system',
    removable: true,
    internal: false,
    solidState: false,
    bus: 'USB',
    diskName: 'WD Elements 25A3'
  },
  {
    id: 'disk3s2',
    device: '/dev/disk3s2',
    name: 'VirtualBox',
    mountPoint: null,
    size: 64 * GB,
    freeSpace: null,
    fsType: 'ntfs',
    content: 'Windows_NTFS',
    isNTFS: true,
    mounted: false,
    readOnly: false,
    writable: false,
    owner: 'none',
    removable: false,
    internal: true,
    solidState: true,
    bus: 'PCI-Express',
    diskName: 'APPLE SSD AP0512Z'
  },
  {
    id: 'disk6s1',
    device: '/dev/disk6s1',
    name: 'SDCARD',
    mountPoint: '/Volumes/SDCARD',
    size: 128 * GB,
    freeSpace: 42 * GB,
    fsType: 'exfat',
    content: 'Windows_FAT_32',
    isNTFS: false,
    mounted: true,
    readOnly: false,
    writable: true,
    owner: 'system',
    removable: true,
    internal: false,
    solidState: true,
    bus: 'USB',
    diskName: 'Built In SDXC Reader'
  }
]

export function mockVolumes(includeNonNtfs: boolean): VolumeInfo[] {
  return volumes
    .filter((volume) => includeNonNtfs || volume.isNTFS)
    .map((volume) => ({ ...volume }))
}

export function mockVolume(id: string): VolumeInfo | null {
  const found = volumes.find((volume) => volume.id === id)
  return found ? { ...found } : null
}

export function mockMount(id: string, readOnly: boolean): VolumeInfo | null {
  const volume = volumes.find((item) => item.id === id)
  if (!volume) return null
  const mountPoint = `/Volumes/${volume.name}`
  volume.mounted = true
  volume.readOnly = readOnly
  volume.writable = !readOnly
  volume.owner = 'ntfs4mac'
  volume.mountPoint = mountPoint
  if (volume.freeSpace === null) volume.freeSpace = Math.round(volume.size * 0.4)
  return { ...volume }
}

export function mockUnmount(id: string): VolumeInfo | null {
  const volume = volumes.find((item) => item.id === id)
  if (!volume) return null
  volume.mounted = false
  volume.readOnly = false
  volume.writable = false
  volume.owner = 'none'
  volume.mountPoint = null
  return { ...volume }
}
