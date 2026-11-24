//
//  dar-monitor
//  通过 Disk Arbitration C API 监听磁盘出现/消失/描述变化，
//  以 JSON Lines 输出给 Electron 主进程（每行一个事件）。
//
//  构建：swiftc -O -o dar-monitor main.swift -framework DiskArbitration -framework Foundation
//

import DiskArbitration
import Foundation

let eventQueue = DispatchQueue(label: "com.ntfs4mac.dar-monitor")

func emit(_ payload: [String: Any]) {
    guard JSONSerialization.isValidJSONObject(payload),
          let data = try? JSONSerialization.data(withJSONObject: payload, options: []),
          let line = String(data: data, encoding: .utf8)
    else { return }

    FileHandle.standardOutput.write((line + "\n").data(using: .utf8)!)
}

func stringValue(_ description: [String: Any], _ key: CFString) -> String? {
    description[key as String] as? String
}

func describe(_ disk: DADisk, event: String) {
    var payload: [String: Any] = ["event": event]

    if let bsdName = DADiskGetBSDName(disk) {
        payload["device"] = "/dev/" + String(cString: bsdName)
        payload["bsdName"] = String(cString: bsdName)
    }

    if let unmanaged = DADiskCopyDescription(disk) {
        let description = unmanaged.takeRetainedValue() as? [String: Any] ?? [:]

        if let devicePath = stringValue(description, kDADiskDescriptionDevicePathKey) {
            payload["devicePath"] = devicePath
        }
        if let volumeName = stringValue(description, kDADiskDescriptionVolumeNameKey) {
            payload["volumeName"] = volumeName
        }
        if let volumeUUID = stringValue(description, kDADiskDescriptionVolumeUUIDKey) {
            payload["volumeUUID"] = volumeUUID
        }
        if let mediaName = stringValue(description, kDADiskDescriptionMediaNameKey) {
            payload["mediaName"] = mediaName
        }
        if let volumePath = stringValue(description, kDADiskDescriptionVolumePathKey) {
            payload["volumePath"] = volumePath
        }
        if let size = description[kDADiskDescriptionMediaSizeKey as String] as? NSNumber {
            payload["size"] = size.int64Value
        }
        if let removable = description[kDADiskDescriptionMediaRemovableKey as String] as? NSNumber {
            payload["removable"] = removable.boolValue
        }
    }

    emit(payload)
}

let appearedCallback: DADiskAppearedCallback = { disk, _ in
    describe(disk, event: "appeared")
}

let disappearedCallback: DADiskDisappearedCallback = { disk, _ in
    describe(disk, event: "disappeared")
}

let descriptionChangedCallback: DADiskDescriptionChangedCallback = { disk, _, _ in
    describe(disk, event: "changed")
}

guard let session = DASessionCreate(kCFAllocatorDefault) else {
    FileHandle.standardError.write("dar-monitor: 无法创建 DA 会话\n".data(using: .utf8)!)
    exit(2)
}

DASessionSetDispatchQueue(session, eventQueue)

DARegisterDiskAppearedCallback(session, nil, appearedCallback, nil)
DARegisterDiskDisappearedCallback(session, nil, disappearedCallback, nil)
DARegisterDiskDescriptionChangedCallback(
    session,
    nil,
    [kDADiskDescriptionVolumeNameKey, kDADiskDescriptionVolumePathKey, kDADiskDescriptionMediaNameKey] as CFArray,
    descriptionChangedCallback,
    nil
)

signal(SIGPIPE, SIG_IGN)
for signalNumber in [SIGINT, SIGTERM] {
    signal(signalNumber, SIG_IGN)
    let source = DispatchSource.makeSignalSource(signal: signalNumber, queue: eventQueue)
    source.setEventHandler { exit(0) }
    source.resume()
}

emit(["event": "ready", "version": "1.0.0", "pid": Int(getpid())])
dispatchMain()
