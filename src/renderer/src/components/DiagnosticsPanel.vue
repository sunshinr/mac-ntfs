<script setup lang="ts">
import type { CheckLevel, DiagnosticReport } from '@shared/types'

defineProps<{
  report: DiagnosticReport | null
  running: boolean
}>()

defineEmits<{
  run: []
}>()

function levelLabel(level: CheckLevel): string {
  return level === 'pass' ? '通过' : level === 'warn' ? '警告' : '失败'
}

function dotClass(level: CheckLevel): string {
  return level === 'pass' ? 'ok' : level === 'warn' ? 'warn' : 'danger'
}
</script>

<template>
  <section class="panel">
    <header class="panel-head">
      <h2>运行自检</h2>
      <el-button text size="small" :loading="running" @click="$emit('run')">重新自检</el-button>
    </header>

    <div v-if="report" class="summary">
      <span class="sum ok">{{ report.summary.pass }} 通过</span>
      <span class="sum warn">{{ report.summary.warn }} 警告</span>
      <span class="sum fail">{{ report.summary.fail }} 失败</span>
    </div>

    <ul v-if="report" class="checks">
      <li v-for="check in report.checks" :key="check.id">
        <span class="state-dot" :class="dotClass(check.level)" aria-hidden="true" />
        <div class="body">
          <div class="title">
            <strong>{{ check.title }}</strong>
            <span class="level" :class="check.level">{{ levelLabel(check.level) }}</span>
          </div>
          <p class="detail selectable">{{ check.detail }}</p>
          <p v-if="check.hint" class="hint">{{ check.hint }}</p>
        </div>
      </li>
    </ul>

    <p v-else class="muted small">尚未生成自检报告，点击“重新自检”开始。</p>
    <p class="foot-note">自检只做只读探测，不会修改磁盘。</p>
  </section>
</template>

<style scoped>
.summary {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
  margin-bottom: 12px;
}

.sum {
  height: 22px;
  padding: 0 9px;
  border-radius: 999px;
  font-size: 11.5px;
  display: inline-flex;
  align-items: center;
}

.sum.ok {
  background: var(--ok-soft);
  color: var(--ok);
}

.sum.warn {
  background: var(--warn-soft);
  color: var(--warn);
}

.sum.fail {
  background: var(--danger-soft);
  color: var(--danger);
}

.checks {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 11px;
  max-height: 300px;
  overflow-y: auto;
  padding-right: 2px;
}

.checks li {
  display: flex;
  gap: 9px;
  align-items: flex-start;
}

.checks .state-dot {
  margin-top: 5px;
}

.body {
  min-width: 0;
  flex: 1;
}

.title {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.title strong {
  font-size: 12.5px;
  font-weight: 600;
}

.level {
  font-size: 10.5px;
  color: var(--text-muted);
  flex: none;
}

.level.fail {
  color: var(--danger);
}

.level.warn {
  color: var(--warn);
}

.detail {
  margin-top: 2px;
  font-size: 11.5px;
  color: var(--text-muted);
  line-height: 1.5;
  word-break: break-all;
}

.hint {
  margin-top: 3px;
  font-size: 11.5px;
  color: var(--warn);
  line-height: 1.5;
}

.small {
  font-size: 12px;
}

.foot-note {
  margin-top: 12px;
  font-size: 11px;
  color: var(--text-faint);
}
</style>
