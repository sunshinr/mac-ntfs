//
//  NTFS4MacHelper
//  以 root 身份运行的特权助手（LaunchDaemon），通过 UNIX domain socket
//  接受白名单内的挂载/卸载命令，避免界面层直接执行 root 命令。
//
//  协议：newline-delimited JSON
//    请求  {"id":"1","action":"run","argv":["/usr/sbin/diskutil","unmount","/dev/disk4s1"],"timeoutMs":15000}
//    请求  {"id":"2","action":"spawn","argv":["/opt/homebrew/bin/ntfs-3g","..."],"logPath":"/var/log/ntfs4mac/xxx.log","startupWaitMs":1200}
//    响应  {"id":"1","ok":true,"code":0,"stdout":"","stderr":""}
//    响应  {"id":"2","ok":true,"pid":1234,"alive":true}
//

import Foundation

let daemon = PrivilegedHelper()
daemon.run()
