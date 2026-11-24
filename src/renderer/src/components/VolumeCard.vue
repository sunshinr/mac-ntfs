<script setup lang="ts">
import { computed } from 'vue'
import { Coin, FolderOpened, SwitchButton } from '@element-plus/icons-vue'
import type { VolumeInfo } from '@shared/types'
import { busLabel, formatBytes, formatPercent } from '../utils/format'

const props = defineProps<{
  volume: VolumeInfo
  busy: boolean
  engineReady: boolean
}>()

defineEmits<{
  mount: [volumeId: string]
  'mount-readonly': [volumeId: string]
  unmount: [volumeId: string]
  reveal: [path: string]
}>()

const stateLabel = computed(() => {
  if (!props.volume.mounted) return '未挂载'
  if (props.volume.writable) return '可读写'
  if (props.volume.owner === 'ntfs4mac') return '只读挂载'
  return '系统只读'
})

const stateTone = computed(() => {
  if (!props.volume.mounted) return 'idle'
  if (props.volume.writable) return 'ok'
  return props.volume.owner === 'ntfs4mac' ? 'info' : 'warn'
})

const usedPercent = computed(() => {
  if (props.volume.freeSpace === null || props.volume.size <= 0) return 0
  return formatPercent(Math.max(0, props.volume.size - props.volume.freeSpace), props.volume.size)
})
</script>

<template>
  <article class="card" :class="{ mounted: volume.mounted, busy }">
    <div class="card-head">
      <div class="icon" :class="stateTone" aria-hidden="true">
        <el-icon :size="19"><Coin /></el-icon>
      </div>
      <div class="titles">
        <div class="name-row">
          <h2 :title="volume.name">{{ volume.name }}</h2>
          <span class="state" :class="stateTone">{{ stateLabel }}</span>
        </div>
        <p class="sub">
          <span class="mono">{{ volume.device }}</span>
          <span class="sep">·</span>
          <span :title="volume.diskName">{{ volume.diskName }}</span>
        </p>
      </div>
    </div>

    <div class="usage">
      <div class="usage-head">
        <span>容量 {{ formatBytes(volume.size) }}</span>
        <span v-if="volume.freeSpace !== null" class="muted">
          可用 {{ formatBytes(volume.freeSpace) }}
        </span>
        <span v-else class="muted">可用空间未知（卷未挂载）</span>
      </div>
      <div class="bar">
        <span :style="{ width: `${usedPercent}%` }" :class="{ high: usedPercent >= 90 }" />
      </div>
    </div>

    <div class="chips">
      <span class="chip">{{ busLabel(volume.bus) }}</span>
      <span class="chip">{{ volume.removable ? '可移动介质' : '内置磁盘' }}</span>
      <span class="chip">{{ volume.fsType ? volume.fsType.toUpperCase() : volume.content || '未知格式' }}</span>
      <span v-if="volume.mounted && volume.mountPoint" class="chip mono" :title="volume.mountPoint">
        {{ volume.mountPoint }}
      </span>
    </div>

    <div class="actions">
      <template v-if="!volume.isNTFS">
        <span class="non-ntfs">仅展示，不提供挂载</span>
        <el-button
          v-if="volume.mounted && volume.mountPoint"
          :icon="FolderOpened"
          :disabled="busy"
          :aria-label="`在访达中显示 ${volume.name}`"
          @click="$emit('reveal', volume.mountPoint)"
        >
          访达
        </el-button>
      </template>
      <template v-else-if="!volume.mounted">
        <el-button
          type="primary"
          :loading="busy"
          :disabled="!engineReady"
          :aria-label="`挂载 ${volume.name}`"
          @click="$emit('mount', volume.id)"
        >
          挂载
        </el-button>
        <el-button
          text
          :disabled="busy || !engineReady"
          :aria-label="`以只读方式挂载 ${volume.name}`"
          @click="$emit('mount-readonly', volume.id)"
        >
          只读挂载
        </el-button>
      </template>
      <template v-else>
        <el-button
          v-if="volume.mountPoint"
          :icon="FolderOpened"
          :disabled="busy"
          :aria-label="`在访达中显示 ${volume.name}`"
          @click="$emit('reveal', volume.mountPoint)"
        >
          访达
        </el-button>
        <el-button
          v-if="!volume.writable"
          type="primary"
          plain
          :loading="busy"
          :disabled="!engineReady"
          :aria-label="`将 ${volume.name} 重新挂载为可写`"
          @click="$emit('mount', volume.id)"
        >
          重挂为可写
        </el-button>
        <el-button
          :icon="SwitchButton"
          type="danger"
          plain
          :loading="busy"
          :aria-label="`卸载 ${volume.name}`"
          @click="$emit('unmount', volume.id)"
        >
          卸载
        </el-button>
      </template>
    </div>
  </article>
</template>

<style scoped>
.card {
  display: flex;
  flex-direction: column;
  gap: 14px;
  padding: 18px;
  border-radius: var(--radius-lg);
  background: var(--panel-solid);
  border: 1px solid var(--border-soft);
  box-shadow: var(--shadow-card);
  transition: transform 0.18s ease, box-shadow 0.18s ease, border-color 0.18s ease;
}

.card:hover {
  transform: translateY(-1px);
  box-shadow: 0 2px 4px rgba(17, 24, 39, 0.04), 0 14px 34px rgba(17, 24, 39, 0.09);
}

.card.mounted {
  border-color: rgba(47, 111, 237, 0.18);
}

.card.busy {
  opacity: 0.86;
}

.card-head {
  display: flex;
  gap: 12px;
  align-items: flex-start;
}

.icon {
  width: 40px;
  height: 40px;
  border-radius: 12px;
  display: grid;
  place-items: center;
  flex: none;
  background: rgba(17, 24, 39, 0.05);
  color: var(--text-muted);
}

.icon.ok {
  background: var(--ok-soft);
  color: var(--ok);
}

.icon.info {
  background: var(--brand-soft);
  color: var(--brand);
}

.icon.warn {
  background: var(--warn-soft);
  color: var(--warn);
}

.titles {
  min-width: 0;
  flex: 1;
}

.name-row {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}

.name-row h2 {
  font-size: 15px;
  font-weight: 600;
  letter-spacing: -0.01em;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.state {
  flex: none;
  height: 20px;
  padding: 0 8px;
  border-radius: 6px;
  font-size: 11px;
  font-weight: 500;
  display: inline-flex;
  align-items: center;
  background: rgba(17, 24, 39, 0.06);
  color: var(--text-muted);
}

.state.ok {
  background: var(--ok-soft);
  color: var(--ok);
}

.state.info {
  background: var(--brand-soft);
  color: var(--brand);
}

.state.warn {
  background: var(--warn-soft);
  color: var(--warn);
}

.sub {
  margin-top: 4px;
  font-size: 11.5px;
  color: var(--text-muted);
  display: flex;
  align-items: center;
  gap: 6px;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.sub .sep {
  color: var(--text-faint);
}

.usage {
  display: flex;
  flex-direction: column;
  gap: 7px;
}

.usage-head {
  display: flex;
  justify-content: space-between;
  gap: 10px;
  font-size: 11.5px;
  color: var(--text-muted);
  font-variant-numeric: tabular-nums;
}

.bar {
  height: 6px;
  border-radius: 999px;
  background: rgba(17, 24, 39, 0.07);
  overflow: hidden;
}

.bar > span {
  display: block;
  height: 100%;
  border-radius: 999px;
  background: linear-gradient(90deg, #4a86ff, #2f6fed);
  transition: width 0.3s ease;
}

.bar > span.high {
  background: linear-gradient(90deg, #f0a13a, #e05d4b);
}

.chips {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.chips .chip {
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
}

.actions {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  margin-top: 2px;
  padding-top: 12px;
  border-top: 1px solid var(--border-soft);
}

.actions :deep(.el-button + .el-button) {
  margin-left: 0;
}

.non-ntfs {
  font-size: 11.5px;
  color: var(--text-faint);
}
</style>
