<script setup lang="ts">
import { ref, watch } from 'vue'
import { CopyDocument } from '@element-plus/icons-vue'
import { ElMessage } from 'element-plus'
import type { BackendStatus } from '@shared/types'

const props = defineProps<{
  modelValue: boolean
  initialTab: string
  status: BackendStatus | null
}>()

const emit = defineEmits<{
  'update:modelValue': [value: boolean]
  'open-security': []
}>()

const tab = ref(props.initialTab || 'kext')
const depsCommand = 'brew install --cask macfuse\nbrew install gromgit/fuse/ntfs-3g-mac'
const helperCommand = 'sudo bash scripts/build-helper.sh --install'
const volumeCheckCommand = 'diskutil list\ndiskutil info /dev/disk4s1 | grep -i "file system"'

watch(
  () => props.modelValue,
  (open) => {
    if (open) tab.value = props.initialTab || 'kext'
  }
)

async function copy(text: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text)
    ElMessage.success('命令已复制')
  } catch {
    ElMessage.warning('复制失败，请手动选择文本')
  }
}
</script>

<template>
  <el-dialog
    :model-value="modelValue"
    width="680px"
    title="权限与安装指引"
    align-center
    @update:model-value="emit('update:modelValue', $event)"
  >
    <el-tabs v-model="tab" class="guide-tabs">
      <el-tab-pane label="macOS 12–15（kext）" name="kext">
        <ol class="steps">
          <li>
            <strong>安装 macFUSE 与 ntfs-3g</strong>
            <div class="cmd mono">
              <code translate="no">{{ depsCommand }}</code>
              <el-button
                text
                size="small"
                :icon="CopyDocument"
                aria-label="复制安装命令"
                @click="copy(depsCommand)"
              />
            </div>
            <p class="note">安装 macFUSE 后需要重启一次。</p>
          </li>
          <li>
            <strong>允许系统扩展</strong>
            <p>打开“系统设置 → 隐私与安全性”，在底部安全性区域点击“允许” macFUSE 的系统软件，然后重启。</p>
          </li>
          <li>
            <strong>Apple 芯片额外步骤</strong>
            <p>关机后长按电源键进入恢复模式 → “实用工具 → 启动安全性实用工具” → 选择启动磁盘 → 将“降低安全性”设为允许用户管理内核扩展 → 重启。</p>
          </li>
          <li>
            <strong>回到本应用点击“重新检测”</strong>
            <p>环境状态中 macFUSE 显示已安装、后端显示 kext，即可开始挂载。</p>
          </li>
        </ol>
        <p class="warn-note">请勿关闭 SIP：本工具不要求关闭系统完整性保护。</p>
      </el-tab-pane>

      <el-tab-pane label="macOS 26+（FSKit）" name="fskit">
        <ol class="steps">
          <li>
            <strong>确认系统版本</strong>
            <p>当前检测到 {{ status?.osVersion ?? '未知版本' }}。macOS 26 起 macFUSE 可能改用 FSKit 后端，不再需要 kext 批准。</p>
          </li>
          <li>
            <strong>安装支持 FSKit 的 macFUSE</strong>
            <p>使用官方最新版本安装包，安装后按提示允许系统扩展（若仍使用 kext 后端）。</p>
          </li>
          <li>
            <strong>实测挂载行为</strong>
            <p>FSKit 与 kext 后端行为可能不同，请先用只读方式挂载验证，再切换到可写。遇到异常请把运行日志反馈给开发者。</p>
          </li>
        </ol>
        <p class="warn-note">该分支仍在实测阶段，不建议直接用于唯一副本的数据盘。</p>
      </el-tab-pane>

      <el-tab-pane label="依赖安装" name="deps">
        <ol class="steps">
          <li>
            <strong>安装 Homebrew（如未安装）</strong>
            <div class="cmd mono">
              <code translate="no">/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"</code>
              <el-button
                text
                size="small"
                :icon="CopyDocument"
                aria-label="复制 Homebrew 安装命令"
                @click="copy('/bin/bash -c &quot;$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)&quot;')"
              />
            </div>
          </li>
          <li>
            <strong>安装 macFUSE 与 ntfs-3g</strong>
            <div class="cmd mono">
              <code translate="no">{{ depsCommand }}</code>
              <el-button
                text
                size="small"
                :icon="CopyDocument"
                aria-label="复制安装命令"
                @click="copy(depsCommand)"
              />
            </div>
            <p class="note">路径差异由 brew --prefix 自动处理：Intel 为 /usr/local，Apple 芯片为 /opt/homebrew。</p>
          </li>
          <li>
            <strong>验证命令行挂载（M0 基线）</strong>
            <div class="cmd mono">
              <code translate="no">{{ volumeCheckCommand }}</code>
              <el-button
                text
                size="small"
                :icon="CopyDocument"
                aria-label="复制验证命令"
                @click="copy(volumeCheckCommand)"
              />
            </div>
            <p class="note">也可直接运行仓库中的 scripts/m0-poc.sh 完成一次挂载、写入与卸载。</p>
          </li>
        </ol>
      </el-tab-pane>

      <el-tab-pane label="特权助手" name="helper">
        <ol class="steps">
          <li>
            <strong>为什么要安装</strong>
            <p>挂载与卸载需要 root 权限。未安装助手时每次操作都会弹出系统管理员授权；安装 LaunchDaemon 后可免密执行。</p>
          </li>
          <li>
            <strong>编译并安装</strong>
            <div class="cmd mono">
              <code translate="no">{{ helperCommand }}</code>
              <el-button
                text
                size="small"
                :icon="CopyDocument"
                aria-label="复制助手安装命令"
                @click="copy(helperCommand)"
              />
            </div>
            <p class="note">脚本会编译 helper、安装 com.ntfs4mac.helper.plist 并启动 LaunchDaemon，需要开发者证书签名。</p>
          </li>
          <li>
            <strong>安全边界</strong>
            <p>助手只接受白名单可执行文件（ntfs-3g / diskutil / umount / mkdir / rmdir），按请求串行执行，不解析任意 shell 字符串。</p>
          </li>
        </ol>
      </el-tab-pane>
    </el-tabs>

    <template #footer>
      <el-button @click="emit('update:modelValue', false)">关闭</el-button>
      <el-button type="primary" :disabled="!status?.isMac" @click="emit('open-security')">
        打开隐私与安全性设置
      </el-button>
    </template>
  </el-dialog>
</template>

<style scoped>
.steps {
  margin: 0;
  padding-left: 18px;
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.steps li {
  font-size: 12.5px;
  line-height: 1.6;
  color: var(--text-main);
}

.steps strong {
  display: block;
  font-size: 13px;
  margin-bottom: 3px;
}

.steps p {
  color: var(--text-muted);
}

.cmd {
  margin-top: 8px;
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 10px;
  padding: 9px 11px;
  border-radius: 9px;
  background: rgba(17, 24, 39, 0.045);
  border: 1px solid var(--border-soft);
}

.cmd code {
  font-size: 11.5px;
  line-height: 1.7;
  white-space: pre-wrap;
  word-break: break-all;
}

.note {
  margin-top: 6px;
  font-size: 11.5px;
  color: var(--text-faint);
}

.warn-note {
  margin-top: 14px;
  padding: 9px 11px;
  border-radius: 9px;
  background: var(--warn-soft);
  color: var(--warn);
  font-size: 11.5px;
  line-height: 1.6;
}
</style>
