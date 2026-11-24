<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import { CopyDocument, Delete, FolderOpened, Search } from '@element-plus/icons-vue'
import { ElMessage } from 'element-plus'
import type { LogEntry, LogLevel } from '@shared/types'
import { formatTime } from '../utils/format'

const props = defineProps<{
  modelValue: boolean
  logs: LogEntry[]
}>()

const emit = defineEmits<{
  'update:modelValue': [value: boolean]
  clear: []
  'open-dir': []
}>()

const level = ref<'all' | LogLevel>('all')
const keyword = ref('')
const autoScroll = ref(true)
const listEl = ref<HTMLDivElement | null>(null)

const filtered = computed(() =>
  props.logs.filter((entry) => {
    if (level.value !== 'all' && entry.level !== level.value) return false
    const query = keyword.value.trim().toLowerCase()
    if (!query) return true
    const haystack = `${entry.scope} ${entry.message} ${entry.detail ?? ''}`.toLowerCase()
    return haystack.includes(query)
  })
)

function scrollToBottom(): void {
  const element = listEl.value
  if (element) element.scrollTop = element.scrollHeight
}

watch(
  () => filtered.value.length,
  async () => {
    if (!props.modelValue || !autoScroll.value) return
    await nextTick()
    scrollToBottom()
  }
)

watch(
  () => props.modelValue,
  async (open) => {
    if (!open) return
    await nextTick()
    scrollToBottom()
  }
)

async function copyAll(): Promise<void> {
  const text = filtered.value
    .map(
      (entry) =>
        `${new Date(entry.time).toISOString()} [${entry.level}] [${entry.scope}] ${entry.message}${
          entry.detail ? ` | ${entry.detail}` : ''
        }`
    )
    .join('\n')

  try {
    await navigator.clipboard.writeText(text)
    ElMessage.success(`已复制 ${filtered.value.length} 条日志`)
  } catch {
    ElMessage.warning('复制失败，请检查系统剪贴板权限')
  }
}
</script>

<template>
  <el-drawer
    :model-value="modelValue"
    direction="btt"
    size="46%"
    :with-header="false"
    class="log-drawer"
    @update:model-value="emit('update:modelValue', $event)"
  >
    <div class="drawer">
      <header class="head">
        <div class="head-left">
          <h2>运行日志</h2>
          <span class="chip">{{ logs.length }} 条</span>
        </div>
        <div class="head-right">
          <el-input
            v-model="keyword"
            size="small"
            placeholder="搜索日志…"
            aria-label="搜索日志"
            :prefix-icon="Search"
            clearable
            class="search"
          />
          <el-radio-group v-model="level" size="small" aria-label="日志级别">
            <el-radio-button value="all">全部</el-radio-button>
            <el-radio-button value="info">信息</el-radio-button>
            <el-radio-button value="warn">警告</el-radio-button>
            <el-radio-button value="error">错误</el-radio-button>
          </el-radio-group>
          <el-checkbox v-model="autoScroll" size="small">自动滚动</el-checkbox>
          <el-button size="small" :icon="CopyDocument" @click="copyAll">复制</el-button>
          <el-button size="small" :icon="FolderOpened" @click="emit('open-dir')">目录</el-button>
          <el-button size="small" type="danger" plain :icon="Delete" @click="emit('clear')">
            清空
          </el-button>
        </div>
      </header>

      <div ref="listEl" class="list selectable">
        <div v-for="entry in filtered" :key="entry.id" class="row" :class="entry.level">
          <span class="time mono">{{ formatTime(entry.time) }}</span>
          <span class="lvl">{{ entry.level.toUpperCase() }}</span>
          <span class="scope">{{ entry.scope }}</span>
          <div class="msg">
            <p>{{ entry.message }}</p>
            <pre v-if="entry.detail">{{ entry.detail.slice(0, 800) }}</pre>
          </div>
        </div>
        <p v-if="!filtered.length" class="empty">暂无匹配的日志</p>
      </div>
    </div>
  </el-drawer>
</template>

<style scoped>
.drawer {
  display: flex;
  flex-direction: column;
  height: 100%;
  padding: 4px 6px 0;
}

.head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
  padding-bottom: 10px;
  border-bottom: 1px solid var(--border-soft);
  flex: none;
}

.head-left {
  display: flex;
  align-items: center;
  gap: 8px;
}

.head-left h2 {
  font-size: 14px;
  font-weight: 600;
}

.head-right {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.search {
  width: 170px;
}

.list {
  flex: 1;
  overflow-y: auto;
  padding: 6px 0 12px;
  font-size: 12px;
}

.row {
  display: grid;
  grid-template-columns: 66px 62px 76px 1fr;
  gap: 8px;
  padding: 5px 6px;
  border-radius: 6px;
  align-items: baseline;
}

.row:hover {
  background: rgba(17, 24, 39, 0.035);
}

.time {
  color: var(--text-faint);
  font-size: 11px;
  font-variant-numeric: tabular-nums;
}

.lvl {
  font-size: 10px;
  font-weight: 600;
  letter-spacing: 0.03em;
  color: var(--text-muted);
}

.row.success .lvl {
  color: var(--ok);
}

.row.warn .lvl {
  color: var(--warn);
}

.row.error .lvl {
  color: var(--danger);
}

.scope {
  font-size: 11px;
  color: var(--text-muted);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.msg p {
  color: var(--text-main);
  line-height: 1.5;
  word-break: break-word;
}

.msg pre {
  margin: 4px 0 0;
  padding: 6px 8px;
  border-radius: 6px;
  background: rgba(17, 24, 39, 0.04);
  color: var(--text-muted);
  font-size: 11px;
  line-height: 1.5;
  white-space: pre-wrap;
  word-break: break-all;
  font-family: 'SF Mono', ui-monospace, Menlo, Consolas, monospace;
}

.empty {
  padding: 24px;
  text-align: center;
  color: var(--text-faint);
}
</style>
