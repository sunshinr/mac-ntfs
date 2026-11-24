<script setup lang="ts">
import { computed } from 'vue'
import { Refresh } from '@element-plus/icons-vue'
import type { BackendIssue, BackendStatus } from '@shared/types'

const props = defineProps<{
  status: BackendStatus | null
  issues: BackendIssue[]
  engineReady: boolean
}>()

defineEmits<{
  refresh: []
  guide: []
}>()

type Tone = 'ok' | 'warn' | 'danger' | 'idle'

interface Row {
  label: string
  value: string
  tone: Tone
  hint?: string
}

const rows = computed<Row[]>(() => {
  const status = props.status
  if (!status) return []

  const helperMode =
    status.helper.mode === 'helper'
      ? 'LaunchDaemon（免密）'
      : status.helper.mode === 'osascript'
        ? '管理员授权弹窗'
        : '演示模式'

  return [
    { label: '系统', value: `${status.osName} ${status.osVersion}`, tone: 'ok' },
    { label: '芯片', value: status.chip, tone: 'ok' },
    {
      label: '后端',
      value:
        status.backend === 'kext'
          ? 'macFUSE kext'
          : status.backend === 'fskit'
            ? 'FSKit（待实测）'
            : '未就绪',
      tone: status.backend === 'unknown' ? 'danger' : status.backend === 'fskit' ? 'warn' : 'ok'
    },
    {
      label: 'macFUSE',
      value: status.macfuse.installed ? `v${status.macfuse.version ?? '已安装'}` : '未安装',
      tone: status.macfuse.installed ? 'ok' : 'danger',
      hint: status.macfuse.path
    },
    {
      label: 'ntfs-3g',
      value: status.ntfs3g.installed ? (status.ntfs3g.version ?? '已安装') : '未安装',
      tone: status.ntfs3g.installed ? 'ok' : 'danger',
      hint: status.ntfs3g.path ?? undefined
    },
    {
      label: '特权方式',
      value: helperMode,
      tone: status.helper.mode === 'helper' ? 'ok' : 'warn',
      hint: status.helper.detail
    },
    {
      label: 'Homebrew',
      value: status.brewPrefix ?? '未找到',
      tone: status.brewPrefix ? 'ok' : 'warn'
    },
    {
      label: 'SIP',
      value:
        status.sipEnabled === null ? '未检测' : status.sipEnabled ? '已开启' : '已关闭（不推荐）',
      tone: status.sipEnabled === false ? 'warn' : 'ok'
    }
  ]
})
</script>

<template>
  <section class="panel">
    <header class="panel-head">
      <h2>环境状态</h2>
      <el-button text size="small" :icon="Refresh" @click="$emit('refresh')">重新检测</el-button>
    </header>

    <ul class="rows">
      <li v-for="row in rows" :key="row.label">
        <span class="label">{{ row.label }}</span>
        <span class="value" :class="row.tone" :title="row.hint ?? row.value">{{ row.value }}</span>
        <span class="state-dot" :class="row.tone === 'idle' ? '' : row.tone" />
      </li>
    </ul>

    <div v-if="issues.length" class="issues">
      <article
        v-for="issue in issues"
        :key="`${issue.code}-${issue.title}`"
        class="issue"
        :class="issue.actionable ? 'actionable' : 'info'"
      >
        <strong>{{ issue.title }}</strong>
        <p>{{ issue.detail }}</p>
        <p class="hint">{{ issue.hint }}</p>
        <el-button v-if="issue.actionable" link type="primary" size="small" @click="$emit('guide')">
          查看处理指引
        </el-button>
      </article>
    </div>

    <p v-if="!issues.length && status && !status.mock" class="all-good">
      <span class="state-dot ok" />
      环境检查通过，可以开始挂载 NTFS 卷
    </p>
  </section>
</template>

<style scoped>
.rows {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
}

.rows li {
  display: grid;
  grid-template-columns: 66px 1fr 8px;
  align-items: center;
  gap: 10px;
  padding: 7px 0;
  border-bottom: 1px dashed var(--border-soft);
}

.rows li:last-child {
  border-bottom: none;
}

.label {
  font-size: 12px;
  color: var(--text-muted);
}

.value {
  font-size: 12px;
  font-weight: 500;
  text-align: right;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
  color: var(--text-main);
}

.value.warn {
  color: var(--warn);
}

.value.danger {
  color: var(--danger);
}

.value.ok {
  color: var(--text-main);
}

.issues {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-top: 14px;
}

.issue {
  padding: 11px 12px;
  border-radius: 10px;
  background: var(--warn-soft);
  border: 1px solid rgba(180, 83, 9, 0.16);
  font-size: 12px;
}

.issue.info {
  background: rgba(17, 24, 39, 0.035);
  border-color: var(--border-soft);
}

.issue strong {
  font-size: 12.5px;
  color: var(--warn);
}

.issue.info strong {
  color: var(--text-main);
}

.issue p {
  margin-top: 4px;
  color: var(--text-muted);
  line-height: 1.55;
}

.issue .hint {
  color: var(--text-main);
  opacity: 0.86;
}

.all-good {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 12px;
  font-size: 12px;
  color: var(--ok);
}
</style>
