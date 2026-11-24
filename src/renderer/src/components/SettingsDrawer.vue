<script setup lang="ts">
import { reactive, watch } from 'vue'
import type { BackendStatus, Settings } from '@shared/types'

const props = defineProps<{
  modelValue: boolean
  settings: Settings
  status: BackendStatus | null
}>()

const emit = defineEmits<{
  'update:modelValue': [value: boolean]
  save: [patch: Partial<Settings>]
}>()

const form = reactive<Settings>({ ...props.settings })

watch(
  () => props.settings,
  (next) => Object.assign(form, next),
  { deep: true }
)

function update<K extends keyof Settings>(key: K, value: Settings[K]): void {
  form[key] = value
  emit('save', { [key]: value } as Partial<Settings>)
}

const pollOptions = [
  { label: '2 秒（更灵敏）', value: 2000 },
  { label: '4 秒（推荐）', value: 4000 },
  { label: '8 秒（更省电）', value: 8000 },
  { label: '15 秒', value: 15000 }
]
</script>

<template>
  <el-drawer
    :model-value="modelValue"
    direction="rtl"
    size="400px"
    title="设置"
    @update:model-value="emit('update:modelValue', $event)"
  >
    <div class="form">
      <section class="group">
        <h2>挂载行为</h2>

        <div class="item">
          <div class="text">
            <strong>插入后自动挂载</strong>
            <p>检测到新的 NTFS 卷时自动挂载，启动时也会尝试重挂。</p>
          </div>
          <el-switch
            :model-value="form.autoMount"
            aria-label="插入后自动挂载"
            @change="update('autoMount', $event === true)"
          />
        </div>

        <div class="item">
          <div class="text">
            <strong>默认只读挂载</strong>
            <p>开启后所有挂载均带 ro 参数，适合先验证数据安全。</p>
          </div>
          <el-switch
            :model-value="form.readOnlyByDefault"
            aria-label="默认只读挂载"
            @change="update('readOnlyByDefault', $event === true)"
          />
        </div>

        <div class="item">
          <div class="text">
            <strong>显示非 NTFS 卷</strong>
            <p>同时列出 exFAT、APFS 等分区，仅作展示，不提供写入。</p>
          </div>
          <el-switch
            :model-value="form.showNonNtfs"
            aria-label="显示非 NTFS 卷"
            @change="update('showNonNtfs', $event === true)"
          />
        </div>

        <div class="item">
          <div class="text">
            <strong>登录时启动</strong>
            <p>仅注册为登录项，不会创建后台常驻进程。</p>
          </div>
          <el-switch
            :model-value="form.launchAtLogin"
            aria-label="登录时启动"
            :disabled="!status?.isMac"
            @change="update('launchAtLogin', $event === true)"
          />
        </div>
      </section>

      <section class="group">
        <h2>ntfs-3g 参数</h2>

        <div class="item">
          <div class="text">
            <strong>allow_other</strong>
            <p>允许其他用户访问已挂载的卷，默认开启。</p>
          </div>
          <el-switch
            :model-value="form.allowOther"
            aria-label="允许其他用户访问已挂载卷"
            @change="update('allowOther', $event === true)"
          />
        </div>

        <div class="item">
          <div class="text">
            <strong>auto_xattr</strong>
            <p>用扩展属性保存 macOS 元数据，减少 ._ 文件。</p>
          </div>
          <el-switch
            :model-value="form.autoXattr"
            aria-label="使用扩展属性保存元数据"
            @change="update('autoXattr', $event === true)"
          />
        </div>

        <div class="field">
          <label>附加挂载参数</label>
          <el-input
            v-model="form.extraOptions"
            aria-label="附加挂载参数"
            placeholder="例如 uid=501,gid=20,umask=022"
            @change="update('extraOptions', form.extraOptions)"
          />
          <p class="note">仅接受字母、数字、下划线及 “key=value” 形式，逗号分隔，最多 8 项。</p>
        </div>
      </section>

      <section class="group">
        <h2>磁盘监听</h2>
        <div class="field">
          <label>轮询间隔</label>
          <el-select
            :model-value="form.pollIntervalMs"
            aria-label="磁盘轮询间隔"
            style="width: 100%"
            @change="update('pollIntervalMs', Number($event))"
          >
            <el-option v-for="option in pollOptions" :key="option.value" :label="option.label" :value="option.value" />
          </el-select>
          <p class="note">安装了 dar-monitor 时优先使用系统磁盘事件，不走轮询。</p>
        </div>
      </section>

      <p class="legal">
        本工具依赖 macFUSE（外部安装）与 ntfs-3g（GPLv2，动态调用、独立分发）。不提供 NTFS 修复、格式化或加密卷支持。
      </p>
    </div>
  </el-drawer>
</template>

<style scoped>
.form {
  display: flex;
  flex-direction: column;
  gap: 24px;
  padding-bottom: 24px;
}

.group h2 {
  font-size: 12px;
  font-weight: 600;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: var(--text-muted);
  margin-bottom: 8px;
}

.item {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
  padding: 11px 0;
  border-bottom: 1px dashed var(--border-soft);
}

.item:last-child {
  border-bottom: none;
}

.text strong {
  font-size: 13px;
  font-weight: 600;
}

.text p {
  margin-top: 3px;
  font-size: 11.5px;
  color: var(--text-muted);
  line-height: 1.55;
}

.field {
  padding: 10px 0;
}

.field label {
  display: block;
  font-size: 13px;
  font-weight: 600;
  margin-bottom: 7px;
}

.note {
  margin-top: 6px;
  font-size: 11px;
  color: var(--text-faint);
  line-height: 1.55;
}

.legal {
  font-size: 11px;
  line-height: 1.6;
  color: var(--text-faint);
  padding-top: 12px;
  border-top: 1px solid var(--border-soft);
}
</style>
