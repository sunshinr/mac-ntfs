<script setup lang="ts">
import { WarningFilled } from '@element-plus/icons-vue'

defineProps<{
  open: boolean
}>()

defineEmits<{
  accept: []
  guide: []
}>()
</script>

<template>
  <el-dialog
    :model-value="open"
    width="560px"
    :show-close="false"
    :close-on-click-modal="false"
    :close-on-press-escape="false"
    align-center
    class="disclaimer"
  >
    <div class="body">
      <div class="icon">
        <el-icon :size="20"><WarningFilled /></el-icon>
      </div>
      <h2>开始前请确认数据安全</h2>
      <p class="lede">
        NTFS 写入依赖用户态文件系统（macFUSE + ntfs-3g），稳定性和性能均低于 Windows 原生驱动。
      </p>

      <ul class="list">
        <li>写入前请备份重要数据，首次使用建议先以“只读挂载”验证卷内容。</li>
        <li>Windows 休眠或开启快速启动时，卷处于锁定状态，本工具会拒绝强挂以保护数据。</li>
        <li>本工具不提供 NTFS 修复、格式化或加密卷支持；异常时请先用 Windows 检查磁盘。</li>
        <li>卸载前请关闭正在读写该卷的应用，避免未落盘的数据丢失。</li>
      </ul>

      <p class="foot">继续即表示你已备份重要数据，并了解用户态写入的固有风险。</p>
    </div>

    <template #footer>
      <el-button @click="$emit('guide')">查看安装指引</el-button>
      <el-button type="primary" @click="$emit('accept')">我已了解，继续</el-button>
    </template>
  </el-dialog>
</template>

<style scoped>
.body {
  padding: 6px 4px 0;
}

.icon {
  width: 40px;
  height: 40px;
  border-radius: 12px;
  display: grid;
  place-items: center;
  background: var(--warn-soft);
  color: var(--warn);
  margin-bottom: 14px;
}

h2 {
  font-size: 18px;
  font-weight: 600;
  letter-spacing: -0.01em;
}

.lede {
  margin-top: 6px;
  font-size: 12.5px;
  line-height: 1.65;
  color: var(--text-muted);
}

.list {
  margin: 16px 0 0;
  padding: 14px 16px 14px 30px;
  border-radius: 12px;
  background: rgba(17, 24, 39, 0.035);
  border: 1px solid var(--border-soft);
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.list li {
  font-size: 12.5px;
  line-height: 1.6;
}

.foot {
  margin-top: 14px;
  font-size: 11.5px;
  color: var(--text-faint);
  line-height: 1.6;
}
</style>
