import type { ErrorCode } from '../../shared/types'

export interface MappedError {
  code: ErrorCode
  message: string
  hint: string
}

interface Rule {
  pattern: RegExp
  code: ErrorCode
  message: string
  hint: string
}

/**
 * 把底层命令输出归一到可操作错误码（计划 5.2-5：权限未批准 / 卷忙 / 休眠锁定 / 引擎缺失）。
 */
const RULES: Rule[] = [
  {
    pattern: /hibernat|fast startup|fast restart|Windows is hibernated/i,
    code: 'HIBERNATED',
    message: '该卷处于 Windows 休眠 / 快速启动锁定状态',
    hint: '为避免数据损坏，本工具不会强行挂载。请进入 Windows 关闭“快速启动”，执行完整关机（非休眠）后再插回 Mac。'
  },
  {
    pattern: /already mounted|is already mounted|Mount is busy/i,
    code: 'ALREADY_MOUNTED',
    message: '该卷已被挂载',
    hint: '先卸载现有的挂载点再重试。'
  },
  {
    pattern: /Resource busy|resource busy|is busy|Volume is busy/i,
    code: 'VOLUME_BUSY',
    message: '卷正被其他进程占用',
    hint: '关闭正在读写该卷的 Finder 窗口或应用；必要时使用强制卸载（可能丢失未落盘数据）。'
  },
  {
    pattern: /Operation not permitted|Permission denied|must be root|a password is required|User canceled|-128|Authorization/i,
    code: 'PERMISSION_DENIED',
    message: '缺少管理员权限或授权被取消',
    hint: '请重新操作并在系统弹窗中输入管理员密码；若已取消，可直接重试。'
  },
  {
    pattern: /NTFS signature is missing|not a valid NTFS|Failed to read NTFS|Failed to access volume|is not NTFS/i,
    code: 'NOT_NTFS',
    message: '目标卷不是有效的 NTFS 文件系统',
    hint: '确认分区类型为 Windows_NTFS；本工具不提供修复或格式化功能。'
  },
  {
    pattern: /device not found|no available FUSE|fuse: |macFUSE|macfuse|kext|System extension/i,
    code: 'FUSE_UNAVAILABLE',
    message: 'macFUSE 不可用或系统扩展未获批准',
    hint: '在“系统设置 → 隐私与安全性”中允许 macFUSE 的系统扩展并重启；Apple 芯片还需在恢复模式降低启动安全性。'
  },
  {
    pattern: /command not found|No such file or directory|ENOENT/i,
    code: 'ENGINE_MISSING',
    message: '未找到 ntfs-3g 可执行文件',
    hint: '执行 brew install gromgit/fuse/ntfs-3g-mac 安装用户态引擎后重试。'
  },
  {
    pattern: /timed out|timeout/i,
    code: 'TIMEOUT',
    message: '操作超时',
    hint: '检查磁盘是否已拔出或存在硬件问题，然后重试。'
  }
]

export function mapFailure(raw: string, fallbackMessage = '操作失败'): MappedError {
  const text = raw.trim()
  for (const rule of RULES) {
    if (rule.pattern.test(text)) {
      return { code: rule.code, message: rule.message, hint: rule.hint }
    }
  }

  const tail = text.split('\n').filter(Boolean).slice(-3).join(' ').slice(0, 400)
  return {
    code: 'UNKNOWN',
    message: tail ? `${fallbackMessage}：${tail}` : fallbackMessage,
    hint: '展开日志面板查看完整输出；仍无法定位时可在诊断页复制环境信息反馈。'
  }
}

/** 后端环境问题同样复用错误码，便于 UI 统一展示。 */
export function issueFromCode(
  code: ErrorCode,
  title: string,
  detail: string,
  hint: string,
  actionable = true
): { code: ErrorCode; title: string; detail: string; hint: string; actionable: boolean } {
  return { code, title, detail, hint, actionable }
}
