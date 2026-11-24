import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import type { Settings } from '../../shared/types'
import type { Logger } from './logger'

export const DEFAULT_SETTINGS: Settings = {
  autoMount: true,
  readOnlyByDefault: false,
  allowOther: true,
  autoXattr: true,
  extraOptions: '',
  pollIntervalMs: 4000,
  showNonNtfs: false,
  launchAtLogin: false,
  disclaimerAccepted: false
}

const EXTRA_OPTION_PATTERN = /^[a-z0-9_]+(=[a-zA-Z0-9_:.-]+)?$/

/** 校验并收敛挂载参数，避免把任意字符串透传给 ntfs-3g。 */
export function sanitizeExtraOptions(input: string): string {
  const parts = input
    .split(',')
    .map((part) => part.trim())
    .filter((part) => part.length > 0 && EXTRA_OPTION_PATTERN.test(part))
    .slice(0, 8)
  return parts.join(',')
}

export class SettingsService {
  private state: Settings

  constructor(
    private readonly file: string,
    private readonly logger: Logger
  ) {
    this.state = { ...DEFAULT_SETTINGS }
    this.load()
  }

  get(): Settings {
    return { ...this.state }
  }

  save(patch: Partial<Settings>): Settings {
    const next: Settings = { ...this.state }
    if (typeof patch.autoMount === 'boolean') next.autoMount = patch.autoMount
    if (typeof patch.readOnlyByDefault === 'boolean') next.readOnlyByDefault = patch.readOnlyByDefault
    if (typeof patch.allowOther === 'boolean') next.allowOther = patch.allowOther
    if (typeof patch.autoXattr === 'boolean') next.autoXattr = patch.autoXattr
    if (typeof patch.showNonNtfs === 'boolean') next.showNonNtfs = patch.showNonNtfs
    if (typeof patch.launchAtLogin === 'boolean') next.launchAtLogin = patch.launchAtLogin
    if (typeof patch.disclaimerAccepted === 'boolean') next.disclaimerAccepted = patch.disclaimerAccepted
    if (typeof patch.extraOptions === 'string') next.extraOptions = sanitizeExtraOptions(patch.extraOptions)
    if (typeof patch.pollIntervalMs === 'number' && Number.isFinite(patch.pollIntervalMs)) {
      next.pollIntervalMs = Math.min(30_000, Math.max(2_000, Math.round(patch.pollIntervalMs)))
    }

    this.state = next
    this.persist()
    this.logger.info('settings', '设置已更新', JSON.stringify(next))
    return this.get()
  }

  private load(): void {
    if (!existsSync(this.file)) {
      this.persist()
      return
    }
    try {
      const raw = JSON.parse(readFileSync(this.file, 'utf8')) as Partial<Settings>
      this.state = {
        ...DEFAULT_SETTINGS,
        ...raw,
        extraOptions: sanitizeExtraOptions(String(raw.extraOptions ?? '')),
        pollIntervalMs: Math.min(30_000, Math.max(2_000, Number(raw.pollIntervalMs) || 4000))
      }
    } catch (error) {
      this.logger.warn('settings', '设置文件损坏，已回退默认值', String(error))
      this.state = { ...DEFAULT_SETTINGS }
    }
  }

  private persist(): void {
    try {
      writeFileSync(this.file, JSON.stringify(this.state, null, 2), 'utf8')
    } catch (error) {
      this.logger.error('settings', '设置保存失败', String(error))
    }
  }
}
