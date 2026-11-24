# resources/bin

打包时该目录会复制到 `Contents/Resources/bin`。

将 `scripts/build-helper.sh` 编译出的 `dar-monitor` 放在这里，应用启动时会优先使用
Disk Arbitration 事件监听；缺失时自动回退为 `diskutil` 轮询。

```bash
bash scripts/build-helper.sh          # 产出 helper/build/dar-monitor
cp helper/build/dar-monitor resources/bin/
```

二进制文件不纳入版本库（`.gitignore` 已排除），避免仓库膨胀。
