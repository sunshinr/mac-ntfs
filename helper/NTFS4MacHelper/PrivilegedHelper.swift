import Darwin
import Foundation

/// 特权助手实现：UNIX socket 服务 + 白名单命令执行。
/// - 只接受控制台用户（/dev/console 的属主）连接
/// - 只允许执行白名单中的绝对路径可执行文件
/// - 所有请求串行处理，避免并发挂载同一个卷
final class PrivilegedHelper {
    private let socketPath = "/var/run/ntfs4mac/helper.sock"
    private let socketDir = "/var/run/ntfs4mac"
    private let logDir = "/var/log/ntfs4mac"
    private let maxRequestBytes = 64 * 1024

    private let allowedExecutables: Set<String> = [
        "/opt/homebrew/bin/ntfs-3g",
        "/usr/local/bin/ntfs-3g",
        "/usr/local/sbin/ntfs-3g",
        "/opt/local/bin/ntfs-3g",
        "/usr/sbin/diskutil",
        "/sbin/umount",
        "/bin/mkdir",
        "/bin/rmdir"
    ]

    private let workQueue = DispatchQueue(label: "com.ntfs4mac.helper.work")

    func run() {
        signal(SIGPIPE, SIG_IGN)

        do {
            try startServer()
        } catch {
            log("启动失败：\(error.localizedDescription)")
            exit(1)
        }

        log("助手已启动，socket=\(socketPath)")
        dispatchMain()
    }

    // MARK: - Socket 服务

    private func startServer() throws {
        let fileManager = FileManager.default
        try fileManager.createDirectory(
            atPath: socketDir,
            withIntermediateDirectories: true,
            attributes: [.posixPermissions: 0o755]
        )
        try? fileManager.createDirectory(
            atPath: logDir,
            withIntermediateDirectories: true,
            attributes: [.posixPermissions: 0o755]
        )

        unlink(socketPath)

        let serverFD = socket(AF_UNIX, SOCK_STREAM, 0)
        guard serverFD >= 0 else {
            throw HelperError.message("socket() 失败：\(errno)")
        }

        var address = sockaddr_un()
        address.sun_family = sa_family_t(AF_UNIX)
        let pathBytes = Array(socketPath.utf8)
        guard pathBytes.count < MemoryLayout.size(ofValue: address.sun_path) else {
            close(serverFD)
            throw HelperError.message("socket 路径过长")
        }

        withUnsafeMutablePointer(to: &address.sun_path) { pointer in
            pointer.withMemoryRebound(to: CChar.self, capacity: pathBytes.count + 1) { destination in
                for (index, byte) in pathBytes.enumerated() {
                    destination[index] = CChar(bitPattern: byte)
                }
                destination[pathBytes.count] = 0
            }
        }

        let addressSize = socklen_t(MemoryLayout<sockaddr_un>.size)
        let bindResult = withUnsafePointer(to: &address) { pointer in
            pointer.withMemoryRebound(to: sockaddr.self, capacity: 1) { bind(serverFD, $0, addressSize) }
        }
        guard bindResult == 0 else {
            close(serverFD)
            throw HelperError.message("bind() 失败：\(errno)")
        }

        // 连接方在 handleClient 中通过 getpeereid 校验
        chmod(socketPath, 0o666)
        guard listen(serverFD, 16) == 0 else {
            close(serverFD)
            throw HelperError.message("listen() 失败：\(errno)")
        }

        // 每个连接单独处理，但实际命令执行进入串行队列
        DispatchQueue.global(qos: .utility).async { [weak self] in
            guard let self else { return }
            while true {
                let clientFD = accept(serverFD, nil, nil)
                if clientFD < 0 { continue }
                DispatchQueue.global(qos: .userInitiated).async {
                    self.handleClient(clientFD)
                }
            }
        }
    }

    private func handleClient(_ clientFD: Int32) {
        defer { close(clientFD) }

        var peerUID: uid_t = 0
        var peerGID: gid_t = 0
        guard getpeereid(clientFD, &peerUID, &peerGID) == 0 else { return }

        let allowedUID = consoleUserUID()
        guard peerUID == allowedUID else {
            respond(clientFD, ["ok": false, "error": "拒绝访问：仅允许控制台用户连接"])
            log("拒绝来自 uid=\(peerUID) 的连接")
            return
        }

        guard let line = readLine(clientFD), let data = line.data(using: .utf8) else { return }
        guard let request = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any] else {
            respond(clientFD, ["ok": false, "error": "请求不是合法 JSON"])
            return
        }

        let requestID = request["id"] as? String ?? ""
        let action = request["action"] as? String ?? ""

        var response: [String: Any]
        switch action {
        case "ping":
            response = ["ok": true, "version": "1.0.0", "pid": Int(getpid())]
        case "run":
            response = execute(request)
        case "spawn":
            response = spawn(request)
        default:
            response = ["ok": false, "error": "未知操作：\(action)"]
        }

        response["id"] = requestID
        respond(clientFD, response)
    }

    // MARK: - 命令执行

    private func execute(_ request: [String: Any]) -> [String: Any] {
        guard let argv = validatedArgv(request["argv"]) else {
            return ["ok": false, "error": "命令不在白名单内"]
        }
        let timeout = (request["timeoutMs"] as? Double ?? 20_000) / 1000
        return runCommand(argv, timeout: timeout)
    }

    private func spawn(_ request: [String: Any]) -> [String: Any] {
        guard let argv = validatedArgv(request["argv"]) else {
            return ["ok": false, "error": "命令不在白名单内"]
        }
        guard let logPath = request["logPath"] as? String,
              logPath.hasPrefix(logDir + "/")
        else {
            return ["ok": false, "error": "日志路径非法"]
        }

        let startupWaitMs = request["startupWaitMs"] as? Int ?? 1200
        return spawnDetached(argv, logPath: logPath, startupWaitMs: startupWaitMs)
    }

    private func runCommand(_ argv: [String], timeout: TimeInterval) -> [String: Any] {
        let process = Process()
        process.executableURL = URL(fileURLWithPath: argv[0])
        process.arguments = Array(argv.dropFirst())

        let stdoutPipe = Pipe()
        let stderrPipe = Pipe()
        process.standardOutput = stdoutPipe
        process.standardError = stderrPipe

        let group = DispatchGroup()
        group.enter()
        process.terminationHandler = { _ in group.leave() }

        do {
            try process.run()
        } catch {
            return ["ok": false, "error": error.localizedDescription]
        }

        if group.wait(timeout: .now() + timeout) == .timedOut {
            process.terminate()
            return ["ok": false, "error": "命令执行超时", "code": -1]
        }

        let stdout = String(data: stdoutPipe.fileHandleForReading.readDataToEndOfFile(), encoding: .utf8) ?? ""
        let stderr = String(data: stderrPipe.fileHandleForReading.readDataToEndOfFile(), encoding: .utf8) ?? ""
        let status = process.terminationStatus

        return ["ok": status == 0, "code": Int(status), "stdout": stdout, "stderr": stderr]
    }

    private func spawnDetached(_ argv: [String], logPath: String, startupWaitMs: Int) -> [String: Any] {
        let fileManager = FileManager.default
        if !fileManager.fileExists(atPath: logPath) {
            fileManager.createFile(
                atPath: logPath,
                contents: nil,
                attributes: [.posixPermissions: 0o644]
            )
        }

        guard let logHandle = FileHandle(forWritingAtPath: logPath),
              let nullInput = FileHandle(forReadingAtPath: "/dev/null")
        else {
            return ["ok": false, "error": "无法打开日志文件"]
        }
        logHandle.seekToEndOfFile()

        let process = Process()
        process.executableURL = URL(fileURLWithPath: argv[0])
        process.arguments = Array(argv.dropFirst())
        process.standardInput = nullInput
        process.standardOutput = logHandle
        process.standardError = logHandle

        do {
            try process.run()
        } catch {
            return ["ok": false, "error": error.localizedDescription]
        }

        let deadline = Date().addingTimeInterval(Double(startupWaitMs) / 1000)
        while process.isRunning && Date() < deadline {
            usleep(50_000)
        }

        if process.isRunning {
            return ["ok": true, "pid": Int(process.processIdentifier), "alive": true]
        }

        return [
            "ok": process.terminationStatus == 0,
            "pid": Int(process.processIdentifier),
            "alive": false,
            "code": Int(process.terminationStatus)
        ]
    }

    // MARK: - 校验与工具

    private func validatedArgv(_ raw: Any?) -> [String]? {
        guard let argv = raw as? [String], !argv.isEmpty, argv.count <= 32 else { return nil }
        guard argv.allSatisfy({ !$0.contains("\u{0}") && $0.count <= 4096 }) else { return nil }
        guard allowedExecutables.contains(argv[0]) else { return nil }
        guard argv[0].hasPrefix("/") else { return nil }
        return argv
    }

    private func consoleUserUID() -> uid_t {
        var info = stat()
        if stat("/dev/console", &info) == 0, info.st_uid != 0 {
            return info.st_uid
        }
        return getuid()
    }

    private func readLine(_ fd: Int32, timeout: TimeInterval = 10) -> String? {
        var data = Data()
        var buffer = [UInt8](repeating: 0, count: 4096)
        let deadline = Date().addingTimeInterval(timeout)

        while data.count < maxRequestBytes && Date() < deadline {
            let count = read(fd, &buffer, buffer.count)
            if count < 0 {
                if errno == EINTR { continue }
                return nil
            }
            if count == 0 { break }

            for index in 0..<count {
                if buffer[index] == 0x0A {
                    return String(data: data, encoding: .utf8)
                }
                data.append(buffer[index])
            }
        }

        return data.isEmpty ? nil : String(data: data, encoding: .utf8)
    }

    private func respond(_ fd: Int32, _ payload: [String: Any]) {
        guard JSONSerialization.isValidJSONObject(payload),
              let data = try? JSONSerialization.data(withJSONObject: payload),
              let line = String(data: data, encoding: .utf8)
        else { return }

        var message = Array((line + "\n").utf8)
        var offset = 0
        while offset < message.count {
            let written = message.withUnsafeBytes { rawBuffer -> Int in
                guard let base = rawBuffer.baseAddress else { return -1 }
                return write(fd, base.advanced(by: offset), message.count - offset)
            }
            if written <= 0 { return }
            offset += written
        }
        _ = message
    }

    private func log(_ message: String) {
        let line = "[\(ISO8601DateFormatter().string(from: Date()))] \(message)\n"
        FileHandle.standardError.write(line.data(using: .utf8)!)
    }
}

enum HelperError: LocalizedError {
    case message(String)

    var errorDescription: String? {
        switch self {
        case .message(let text):
            return text
        }
    }
}
