<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { ElMessageBox } from 'element-plus'
import { Coin, InfoFilled, Refresh } from '@element-plus/icons-vue'
import type { Settings } from '@shared/types'
import TitleBar from './components/TitleBar.vue'
import VolumeCard from './components/VolumeCard.vue'
import StatusPanel from './components/StatusPanel.vue'
import DiagnosticsPanel from './components/DiagnosticsPanel.vue'
import LogDrawer from './components/LogDrawer.vue'
import SettingsDrawer from './components/SettingsDrawer.vue'
import GuideDialog from './components/GuideDialog.vue'
import DisclaimerDialog from './components/DisclaimerDialog.vue'
import { useApp } from './composables/useApp'

const {
  state,
  logs,
  booting,
  fatal,
  status,
  platform,
  volumes,
  settings,
  issues,
  busy,
  engineReady,
  diagnostics,
  refreshing,
  appVersion,
  writableCount,
  init,
  refresh,
  mount,
  unmount,
  diagnose,
  saveSettings,
  clearLogs,
  openLogDir,
  openSecuritySettings,
  reveal,
  dispose
} = useApp()

const logVisible = ref(false)
const settingsVisible = ref(false)
const guideVisible = ref(false)
const guideTab = ref('kext')
const diagnosing = ref(false)

const showDisclaimer = computed(() => Boolean(state.value) && !settings.value.disclaimerAccepted)
const primaryIssue = computed(() => issues.value.find((issue) => issue.actionable) ?? issues.value[0] ?? null)

onMounted(() => {
  void init()
})

onBeforeUnmount(() => dispose())

function openGuide(tab?: string): void {
  if (tab) {
    guideTab.value = tab
  } else if (status.value?.backend === 'fskit') {
    guideTab.value = 'fskit'
  } else if (
    status.value?.issues.some(
      (issue) => issue.code === 'FUSE_UNAVAILABLE' || issue.code === 'ENGINE_MISSING'
    )
  ) {
    guideTab.value = 'deps'
  } else {
    guideTab.value = 'kext'
  }
  guideVisible.value = true
}

async function toggleSetting(key: 'autoMount' | 'showNonNtfs', value: string | number | boolean): Promise<void> {
  await saveSettings({ [key]: value === true } as Partial<Settings>)
}

async function handleMount(volumeId: string): Promise<void> {
  await mount(volumeId, { readOnly: settings.value.readOnlyByDefault })
}

async function handleMountReadOnly(volumeId: string): Promise<void> {
  await mount(volumeId, { readOnly: true })
}

async function handleUnmount(volumeId: string): Promise<void> {
  const result = await unmount(volumeId)
  if (result.ok) return
  if (result.code !== 'VOLUME_BUSY' && result.code !== 'UNKNOWN' && result.code !== 'TIMEOUT') return

  try {
    await ElMessageBox.confirm('强制卸载可能丢失尚未写入的数据，确定继续吗？', '卷仍被占用', {
      type: 'warning',
      confirmButtonText: '强制卸载',
      cancelButtonText: '取消',
      confirmButtonClass: 'el-button--danger'
    })
  } catch {
    return
  }
  await unmount(volumeId, true)
}

async function runDiagnosis(): Promise<void> {
  diagnosing.value = true
  try {
    await diagnose()
  } finally {
    diagnosing.value = false
  }
}

async function acceptDisclaimer(): Promise<void> {
  await saveSettings({ disclaimerAccepted: true })
}
</script>

<template>
  <div class="shell" :class="`platform-${platform}`">
    <TitleBar
      :status="status"
      :refreshing="refreshing"
      :engine-ready="engineReady"
      @refresh="refresh"
      @logs="logVisible = true"
      @settings="settingsVisible = true"
      @guide="openGuide()"
    />

    <div class="scroll">
      <div class="page">
        <section class="hero">
          <div class="hero-text">
            <h1>NTFS 卷</h1>
            <p class="lede">
              共 <strong>{{ volumes.length }}</strong> 个卷
              <span v-if="writableCount"> · <strong>{{ writableCount }}</strong> 个当前可写</span>
              <span v-if="status?.mock" class="mock-tag">演示数据</span>
            </p>
          </div>
          <div class="hero-controls">
            <label class="switch-group">
              <el-switch
                :model-value="settings.autoMount"
                @change="toggleSetting('autoMount', $event)"
              />
              <span>插入后自动挂载</span>
            </label>
            <label class="switch-group">
              <el-switch
                :model-value="settings.showNonNtfs"
                @change="toggleSetting('showNonNtfs', $event)"
              />
              <span>显示非 NTFS</span>
            </label>
            <el-button :icon="Refresh" :loading="refreshing" @click="refresh">重新扫描</el-button>
          </div>
        </section>

        <el-alert v-if="primaryIssue" class="issue" type="warning" :closable="false" show-icon>
          <template #title>
            <strong>{{ primaryIssue.title }}</strong>
            <span class="issue-detail"> · {{ primaryIssue.detail }}</span>
          </template>
          <div class="issue-body">
            <span>{{ primaryIssue.hint }}</span>
            <el-button link type="primary" @click="openGuide()">查看处理指引 →</el-button>
          </div>
        </el-alert>

        <div class="layout">
          <section class="main-col">
            <div v-if="volumes.length" class="grid">
              <VolumeCard
                v-for="volume in volumes"
                :key="volume.id"
                :volume="volume"
                :busy="Boolean(busy[volume.id])"
                :engine-ready="engineReady"
                @mount="handleMount"
                @mount-readonly="handleMountReadOnly"
                @unmount="handleUnmount"
                @reveal="reveal"
              />
            </div>

            <div v-else class="empty">
              <div class="empty-icon">
                <el-icon :size="26"><Coin /></el-icon>
              </div>
              <h3>未发现 NTFS 卷</h3>
              <p>
                连接 NTFS 磁盘后会自动出现在这里。若已插入，请尝试重新扫描，或打开“显示非 NTFS”确认分区是否被识别。
              </p>
              <el-button :icon="Refresh" @click="refresh">重新扫描</el-button>
            </div>

            <div class="tips">
              <el-icon :size="16"><InfoFilled /></el-icon>
              <div>
                <strong>写入前请注意</strong>
                <p>
                  macFUSE 属用户态实现，性能低于原生驱动。请先在 Windows 完整关机（关闭快速启动）并备份重要数据。休眠锁定或卷被占用时，本工具会保持只读并给出提示。
                </p>
              </div>
            </div>
          </section>

          <aside class="side-col">
            <StatusPanel
              :status="status"
              :issues="issues"
              :engine-ready="engineReady"
              @refresh="refresh"
              @guide="openGuide()"
            />
            <DiagnosticsPanel :report="diagnostics" :running="diagnosing" @run="runDiagnosis" />
          </aside>
        </div>

        <footer class="foot">
          <span>v{{ appVersion }} · macFUSE + ntfs-3g</span>
          <span class="dot-sep">·</span>
          <el-button link @click="logVisible = true">运行日志</el-button>
          <span class="dot-sep">·</span>
          <el-button link @click="openLogDir">日志目录</el-button>
          <span class="dot-sep">·</span>
          <el-button link @click="openGuide('deps')">依赖说明</el-button>
          <span class="grow" />
          <span class="muted">数据无价，操作前请备份</span>
        </footer>
      </div>
    </div>

    <LogDrawer
      v-model="logVisible"
      :logs="logs"
      @clear="clearLogs"
      @open-dir="openLogDir"
    />

    <SettingsDrawer
      v-model="settingsVisible"
      :settings="settings"
      :status="status"
      @save="saveSettings"
    />

    <GuideDialog
      v-model="guideVisible"
      :initial-tab="guideTab"
      :status="status"
      @open-security="openSecuritySettings"
    />

    <DisclaimerDialog :open="showDisclaimer" @accept="acceptDisclaimer" @guide="openGuide('kext')" />

    <div v-if="booting" class="overlay">
      <div class="spinner" />
      <p>正在连接主进程并检测环境…</p>
    </div>

    <div v-else-if="fatal" class="overlay">
      <h2>启动失败</h2>
      <p>{{ fatal }}</p>
      <el-button @click="refresh">重试</el-button>
    </div>
  </div>
</template>

<style scoped>
.shell {
  display: flex;
  flex-direction: column;
  height: 100%;
  background:
    radial-gradient(1200px 500px at 15% -10%, rgba(47, 111, 237, 0.1), transparent 60%),
    radial-gradient(900px 420px at 100% 0%, rgba(26, 127, 69, 0.07), transparent 55%),
    var(--app-bg);
}

.scroll {
  flex: 1;
  overflow-y: auto;
  overflow-x: hidden;
}

.page {
  max-width: 1280px;
  margin: 0 auto;
  padding: 22px 24px 30px;
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.hero {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 18px;
  flex-wrap: wrap;
}

.hero h1 {
  font-size: 24px;
  font-weight: 650;
  letter-spacing: -0.02em;
}

.lede {
  margin-top: 5px;
  font-size: 12.5px;
  color: var(--text-muted);
}

.lede strong {
  color: var(--text-main);
  font-weight: 600;
}

.mock-tag {
  margin-left: 8px;
  padding: 2px 8px;
  border-radius: 999px;
  background: var(--warn-soft);
  color: var(--warn);
  font-size: 11px;
}

.hero-controls {
  display: flex;
  align-items: center;
  gap: 14px;
  flex-wrap: wrap;
}

.switch-group {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  font-size: 12px;
  color: var(--text-muted);
  cursor: pointer;
}

.issue {
  border-radius: 12px;
}

.issue-detail {
  font-weight: 400;
  color: var(--text-muted);
}

.issue-body {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
  margin-top: 4px;
  font-size: 12px;
  line-height: 1.6;
}

.layout {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 328px;
  gap: 16px;
  align-items: start;
}

.main-col {
  display: flex;
  flex-direction: column;
  gap: 14px;
  min-width: 0;
}

.grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 14px;
}

.side-col {
  display: flex;
  flex-direction: column;
  gap: 14px;
  position: sticky;
  top: 4px;
}

.empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 10px;
  padding: 52px 24px;
  border-radius: var(--radius-lg);
  border: 1px dashed var(--border-strong);
  background: rgba(255, 255, 255, 0.55);
  text-align: center;
}

.empty-icon {
  width: 52px;
  height: 52px;
  border-radius: 16px;
  display: grid;
  place-items: center;
  background: var(--brand-soft);
  color: var(--brand);
}

.empty h3 {
  font-size: 15px;
  font-weight: 600;
}

.empty p {
  max-width: 420px;
  font-size: 12.5px;
  line-height: 1.65;
  color: var(--text-muted);
}

.tips {
  display: flex;
  gap: 10px;
  padding: 13px 15px;
  border-radius: 12px;
  background: rgba(255, 255, 255, 0.6);
  border: 1px solid var(--border-soft);
  color: var(--text-muted);
}

.tips strong {
  display: block;
  font-size: 12.5px;
  color: var(--text-main);
  margin-bottom: 3px;
}

.tips p {
  font-size: 11.5px;
  line-height: 1.65;
}

.foot {
  display: flex;
  align-items: center;
  gap: 6px;
  padding-top: 10px;
  font-size: 11px;
  color: var(--text-faint);
  flex-wrap: wrap;
}

.foot :deep(.el-button) {
  font-size: 11px;
  color: var(--text-faint);
  height: auto;
  padding: 0;
}

.foot :deep(.el-button:hover) {
  color: var(--brand);
}

.dot-sep {
  color: var(--text-faint);
}

.grow {
  flex: 1;
}

.overlay {
  position: fixed;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;
  background: rgba(248, 249, 251, 0.92);
  backdrop-filter: blur(8px);
  z-index: 3000;
  font-size: 13px;
  color: var(--text-muted);
}

.spinner {
  width: 26px;
  height: 26px;
  border-radius: 50%;
  border: 2.5px solid rgba(47, 111, 237, 0.2);
  border-top-color: var(--brand);
  animation: spin 0.8s linear infinite;
}

@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}

@media (max-width: 1180px) {
  .layout {
    grid-template-columns: minmax(0, 1fr);
  }

  .side-col {
    position: static;
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}

@media (max-width: 900px) {
  .grid {
    grid-template-columns: minmax(0, 1fr);
  }

  .side-col {
    grid-template-columns: minmax(0, 1fr);
  }
}
</style>
