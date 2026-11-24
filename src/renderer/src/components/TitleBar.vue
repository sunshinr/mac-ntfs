<script setup lang="ts">
import { computed } from 'vue'
import { Document, Refresh, Setting } from '@element-plus/icons-vue'
import type { BackendStatus } from '@shared/types'

const props = defineProps<{
  status: BackendStatus | null
  refreshing: boolean
  engineReady: boolean
}>()

defineEmits<{
  refresh: []
  logs: []
  settings: []
  guide: []
}>()

const engineLabel = computed(() => {
  if (!props.status) return '正在检测环境'
  if (props.status.mock) return '演示模式'
  if (props.engineReady) return '引擎就绪'
  return props.status.issues.length > 0 ? '需要处理' : '引擎未就绪'
})

const engineTone = computed(() => {
  if (!props.status) return 'warn'
  if (props.status.mock) return 'mock'
  return props.engineReady ? 'ok' : 'danger'
})

const osLabel = computed(() =>
  props.status ? `${props.status.osName} ${props.status.osVersion} · ${props.status.arch}` : ''
)
</script>

<template>
  <header class="titlebar">
    <div class="brand">
      <div class="logo" aria-hidden="true">NT</div>
      <div class="brand-text">
        <strong>NTFS for Mac</strong>
        <span>{{ osLabel || 'macFUSE · ntfs-3g' }}</span>
      </div>
    </div>

    <div class="actions">
      <button class="status-pill" :class="engineTone" type="button" @click="$emit('guide')">
        <span class="state-dot" :class="engineTone === 'mock' ? 'warn' : engineTone" aria-hidden="true" />
        {{ engineLabel }}
      </button>
      <el-tooltip content="重新扫描磁盘" placement="bottom">
        <el-button
          text
          circle
          :icon="Refresh"
          :loading="refreshing"
          aria-label="重新扫描磁盘"
          @click="$emit('refresh')"
        />
      </el-tooltip>
      <el-tooltip content="运行日志" placement="bottom">
        <el-button text circle :icon="Document" aria-label="打开运行日志" @click="$emit('logs')" />
      </el-tooltip>
      <el-tooltip content="设置" placement="bottom">
        <el-button text circle :icon="Setting" aria-label="打开设置" @click="$emit('settings')" />
      </el-tooltip>
    </div>
  </header>
</template>

<style scoped>
.titlebar {
  -webkit-app-region: drag;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  height: 60px;
  padding: 0 18px;
  flex: none;
  background: rgba(255, 255, 255, 0.72);
  backdrop-filter: saturate(180%) blur(20px);
  border-bottom: 1px solid var(--border-soft);
}

.brand {
  display: flex;
  align-items: center;
  gap: 11px;
  min-width: 0;
}

.logo {
  width: 32px;
  height: 32px;
  border-radius: 9px;
  display: grid;
  place-items: center;
  font-size: 12.5px;
  font-weight: 700;
  letter-spacing: 0.02em;
  color: #fff;
  background: linear-gradient(145deg, #4a86ff, #2456d6);
  box-shadow: 0 4px 10px rgba(47, 111, 237, 0.32);
  flex: none;
}

.brand-text {
  display: flex;
  flex-direction: column;
  line-height: 1.25;
  min-width: 0;
}

.brand-text strong {
  font-size: 13.5px;
  font-weight: 600;
}

.brand-text span {
  font-size: 11.5px;
  color: var(--text-muted);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.actions {
  -webkit-app-region: no-drag;
  display: flex;
  align-items: center;
  gap: 2px;
}

.status-pill {
  -webkit-app-region: no-drag;
  display: inline-flex;
  align-items: center;
  gap: 7px;
  height: 28px;
  padding: 0 12px;
  margin-right: 6px;
  border-radius: 999px;
  border: 1px solid var(--border-soft);
  background: rgba(255, 255, 255, 0.9);
  color: var(--text-main);
  font-size: 12px;
  font-weight: 500;
  cursor: pointer;
  transition: border-color 0.16s ease, background 0.16s ease;
}

.status-pill:hover {
  border-color: var(--border-strong);
  background: #fff;
}

.status-pill:focus-visible {
  outline: 2px solid var(--brand);
  outline-offset: 2px;
}
</style>
