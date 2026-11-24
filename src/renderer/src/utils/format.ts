const UNITS = ['B', 'KB', 'MB', 'GB', 'TB', 'PB']

export function formatBytes(bytes: number | null | undefined): string {
  if (bytes === null || bytes === undefined || !Number.isFinite(bytes) || bytes <= 0) return '—'
  let value = bytes
  let unit = 0
  while (value >= 1024 && unit < UNITS.length - 1) {
    value /= 1024
    unit += 1
  }
  const digits = value >= 100 || unit === 0 ? 0 : 1
  return `${value.toFixed(digits)} ${UNITS[unit]}`
}

export function formatPercent(part: number, total: number): number {
  if (!total || total <= 0) return 0
  return Math.min(100, Math.max(0, Math.round((part / total) * 100)))
}

export function formatTime(timestamp: number): string {
  const date = new Date(timestamp)
  const pad = (value: number): string => String(value).padStart(2, '0')
  return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
}

export function formatDateTime(timestamp: number): string {
  if (!timestamp) return '—'
  return new Intl.DateTimeFormat('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  }).format(timestamp)
}

export function truncateMiddle(text: string, max = 48): string {
  if (text.length <= max) return text
  const head = Math.ceil((max - 1) / 2)
  const tail = Math.floor((max - 1) / 2)
  return `${text.slice(0, head)}…${text.slice(-tail)}`
}

export function busLabel(bus: string): string {
  if (!bus) return '未知总线'
  const map: Record<string, string> = {
    USB: 'USB',
    'PCI-Express': 'PCIe',
    SATA: 'SATA',
    'Apple Fabric': 'Apple Fabric',
    Thunderbolt: '雷雳'
  }
  return map[bus] ?? bus
}
