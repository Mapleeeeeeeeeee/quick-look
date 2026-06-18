import Cocoa
import WebKit

struct FileRequest {
    let path: String
    let startLine: Int?
    let endLine: Int?
}

struct FileRequestPayload: Codable {
    let path: String
    let startLine: Int?
    let endLine: Int?
}

class PreviewPanel: NSPanel {
    override var canBecomeKey: Bool { true }
    override var canBecomeMain: Bool { true }
}

class DragHandleView: NSView {
    override func hitTest(_ point: NSPoint) -> NSView? {
        let local = convert(point, from: superview)
        // 48px = 24px close button + 12px header padding + 12px comfort margin
        if local.x > bounds.width - 48 { return nil }
        return super.hitTest(point)
    }

    override func mouseDown(with event: NSEvent) {
        window?.performDrag(with: event)
    }
}

// Parses CLI arguments into a (path, startLine, endLine) tuple.
// Used by both AppDelegate and the socket IPC path so the logic lives in one place.
func parseArguments(_ args: [String]) -> (path: String?, startLine: Int?, endLine: Int?) {
    var filePath: String?
    var startLine: Int?
    var endLine: Int?

    var i = 1
    while i < args.count {
        switch args[i] {
        case "--start-line":
            if i + 1 < args.count {
                startLine = Int(args[i + 1])
                i += 2
                continue
            }
        case "--end-line":
            if i + 1 < args.count {
                endLine = Int(args[i + 1])
                i += 2
                continue
            }
        default:
            if !args[i].hasPrefix("-") && filePath == nil {
                filePath = args[i]
            }
        }
        i += 1
    }

    return (filePath, startLine, endLine)
}

class AppDelegate: NSObject, NSApplicationDelegate, WKNavigationDelegate, WKScriptMessageHandler {
    var panel: PreviewPanel!
    var webView: WKWebView!
    var pendingRequest: FileRequest?
    var webViewReady = false
    var searchActive = false
    var previousApp: NSRunningApplication?
    var socketSource: DispatchSourceRead?
    var panelHidden = true

    func enterSearchMode() {
        searchActive = true
        previousApp = NSWorkspace.shared.frontmostApplication
        NSApp.setActivationPolicy(.regular)
        panel.styleMask.remove(.nonactivatingPanel)
        panel.becomesKeyOnlyIfNeeded = false
        if #available(macOS 14.0, *) {
            NSApp.activate()
        } else {
            NSApp.activate(ignoringOtherApps: true)
        }
        panel.makeKeyAndOrderFront(nil)
        panel.makeFirstResponder(webView)
    }

    func exitSearchMode() {
        searchActive = false
        panel.styleMask.insert(.nonactivatingPanel)
        panel.becomesKeyOnlyIfNeeded = true
        NSApp.setActivationPolicy(.accessory)
        if let prev = previousApp {
            prev.activate(options: .activateIgnoringOtherApps)
            previousApp = nil
        }
    }

    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        if message.name == "close" {
            exitSearchMode()
            panelHidden = true
            panel.orderOut(nil)
        } else if message.name == "openExternal", let urlString = message.body as? String,
                  let url = URL(string: urlString) {
            NSWorkspace.shared.open(url)
        }
    }

    func applicationDidFinishLaunching(_ notification: Notification) {
        NSApp.setActivationPolicy(.accessory)

        setupPanel()

        let args = ProcessInfo.processInfo.arguments
        if let request = parseArgs(Array(args)) {
            showFile(request)
        }
    }

    func setupPanel() {
        panel = PreviewPanel(
            contentRect: NSRect(x: 0, y: 0, width: 900, height: 650),
            styleMask: [.borderless, .nonactivatingPanel, .resizable],
            backing: .buffered,
            defer: false
        )
        panel.isOpaque = false
        panel.backgroundColor = NSColor(red: 0.118, green: 0.118, blue: 0.118, alpha: 1.0)
        panel.hasShadow = true
        panel.level = .floating
        panel.isFloatingPanel = true
        panel.hidesOnDeactivate = false
        panel.becomesKeyOnlyIfNeeded = true
        panel.center()

        let config = WKWebViewConfiguration()
        config.preferences.setValue(true, forKey: "allowFileAccessFromFileURLs")
        config.userContentController.add(self, name: "close")
        config.userContentController.add(self, name: "openExternal")

        let contentRect = NSRect(x: 0, y: 0, width: 900, height: 650)
        webView = WKWebView(frame: contentRect, configuration: config)
        webView.autoresizingMask = [.width, .height]
        webView.navigationDelegate = self

        let containerView = NSView(frame: contentRect)
        containerView.autoresizesSubviews = true

        webView.frame = contentRect
        containerView.addSubview(webView)

        let dragHandle = DragHandleView(frame: NSRect(x: 0, y: contentRect.height - 32, width: contentRect.width, height: 32))
        dragHandle.autoresizingMask = [.width, .minYMargin]
        containerView.addSubview(dragHandle)

        panel.contentView = containerView

        if let indexURL = findDistPath() {
            webView.loadFileURL(indexURL, allowingReadAccessTo: URL(fileURLWithPath: "/"))
        }

        setupEscTap()
    }

    func setupEscTap() {
        let refcon = Unmanaged.passUnretained(self).toOpaque()
        let eventMask = CGEventMask(1 << CGEventType.keyDown.rawValue)

        guard let tap = CGEvent.tapCreate(
            tap: .cgSessionEventTap,
            place: .headInsertEventTap,
            options: .defaultTap,
            eventsOfInterest: eventMask,
            callback: { _, _, event, refcon -> Unmanaged<CGEvent>? in
                let keycode = event.getIntegerValueField(.keyboardEventKeycode)
                let delegate = Unmanaged<AppDelegate>.fromOpaque(refcon!).takeUnretainedValue()
                guard delegate.panel.isVisible else {
                    return Unmanaged.passRetained(event)
                }

                if delegate.searchActive {
                    if keycode == 53 {
                        DispatchQueue.main.async { delegate.exitSearchMode() }
                        return Unmanaged.passRetained(event)
                    }
                    if keycode == 50 {
                        DispatchQueue.main.async {
                            delegate.exitSearchMode()
                            delegate.panelHidden = true
                            delegate.panel.orderOut(nil)
                        }
                        return nil
                    }
                    return Unmanaged.passRetained(event)
                }

                if keycode == 50 {
                    DispatchQueue.main.async {
                        delegate.panelHidden = true
                        delegate.panel.orderOut(nil)
                    }
                    return nil
                }

                if keycode == 48 {
                    DispatchQueue.main.async {
                        delegate.webView.evaluateJavaScript("window.cycleTab && window.cycleTab()") { _, _ in }
                    }
                    return nil
                }

                let flags = event.flags
                if keycode == 3 && flags.contains(.maskCommand) {
                    DispatchQueue.main.async {
                        delegate.enterSearchMode()
                        delegate.webView.evaluateJavaScript("window.triggerSearch && window.triggerSearch()") { _, _ in }
                    }
                    return nil
                }

                return Unmanaged.passRetained(event)
            },
            userInfo: refcon
        ) else {
            print("CGEvent tap failed — grant Accessibility permission in System Settings")
            return
        }

        let source = CFMachPortCreateRunLoopSource(nil, tap, 0)
        CFRunLoopAddSource(CFRunLoopGetMain(), source, .commonModes)
    }

    func findDistPath() -> URL? {
        let binaryURL = URL(fileURLWithPath: ProcessInfo.processInfo.arguments[0])
        let candidates = [
            binaryURL.deletingLastPathComponent().appendingPathComponent("../dist/index.html"),
            binaryURL.deletingLastPathComponent().appendingPathComponent("../../dist/index.html"),
            URL(fileURLWithPath: FileManager.default.currentDirectoryPath).appendingPathComponent("dist/index.html"),
        ]
        return candidates.first { FileManager.default.fileExists(atPath: $0.standardized.path) }
    }

    func parseArgs(_ args: [String]) -> FileRequest? {
        let (path, startLine, endLine) = parseArguments(args)
        guard let p = path else { return nil }
        return FileRequest(path: p, startLine: startLine, endLine: endLine)
    }

    func showFile(_ request: FileRequest) {
        if panelHidden {
            panelHidden = false
            webView.evaluateJavaScript("window.clearTabs && window.clearTabs()") { _, _ in }
        }
        panel.orderFrontRegardless()
        if webViewReady {
            injectFileRequest(request)
        } else {
            pendingRequest = request
        }
    }

    func injectFileRequest(_ request: FileRequest) {
        let payload = FileRequestPayload(path: request.path, startLine: request.startLine, endLine: request.endLine)
        guard let jsonData = try? JSONEncoder().encode(payload),
              let json = String(data: jsonData, encoding: .utf8) else { return }

        webView.evaluateJavaScript("window.handleFileRequest(\(json))") { _, error in
            if let error = error {
                print("JS error: \(error)")
            }
        }
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        webViewReady = true
        if let request = pendingRequest {
            pendingRequest = nil
            injectFileRequest(request)
        }
    }

    func webView(_ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction, decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        guard let url = navigationAction.request.url else {
            decisionHandler(.allow)
            return
        }

        // Allow file:// URLs (our local app) and about:blank
        if url.scheme == "file" || url.scheme == "about" {
            decisionHandler(.allow)
            return
        }

        // External URL (http, https, etc.) — open in system browser, cancel WKWebView navigation
        if url.scheme == "http" || url.scheme == "https" {
            NSWorkspace.shared.open(url)
        }
        decisionHandler(.cancel)
    }

    func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
    }

    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
    }

}

// MARK: - Unix Domain Socket IPC

let socketPath = "/tmp/quick-look.sock"

/// Attempt to send a file request to an existing instance via the Unix domain socket.
/// Returns true if an existing instance received the message (caller should exit).
func sendToExistingInstance(_ args: [String]) -> Bool {
    let (path, startLine, endLine) = parseArguments(args)
    guard let p = path else { return false }

    let payload = FileRequestPayload(path: p, startLine: startLine, endLine: endLine)
    guard let jsonData = try? JSONEncoder().encode(payload) else { return false }

    let fd = socket(AF_UNIX, SOCK_STREAM, 0)
    guard fd >= 0 else { return false }
    defer { close(fd) }

    var addr = sockaddr_un()
    addr.sun_family = sa_family_t(AF_UNIX)
    _ = socketPath.withCString { src in
        withUnsafeMutablePointer(to: &addr.sun_path) { pathPtr in
            pathPtr.withMemoryRebound(to: CChar.self, capacity: MemoryLayout<sockaddr_un>.size) { dst in
                strncpy(dst, src, 104 - 1)
            }
        }
    }

    let connectResult = withUnsafePointer(to: &addr) { ptr in
        ptr.withMemoryRebound(to: sockaddr.self, capacity: 1) { sockPtr in
            connect(fd, sockPtr, socklen_t(MemoryLayout<sockaddr_un>.size))
        }
    }

    guard connectResult == 0 else { return false }

    _ = jsonData.withUnsafeBytes { bufPtr in
        write(fd, bufPtr.baseAddress!, bufPtr.count)
    }
    return true
}

/// Try to bind the socket. Returns the listening fd on success, or -1 if another instance holds it.
func tryBindSocket() -> Int32 {
    let serverFd = socket(AF_UNIX, SOCK_STREAM, 0)
    guard serverFd >= 0 else { return -1 }

    var addr = sockaddr_un()
    addr.sun_family = sa_family_t(AF_UNIX)
    _ = socketPath.withCString { src in
        withUnsafeMutablePointer(to: &addr.sun_path) { pathPtr in
            pathPtr.withMemoryRebound(to: CChar.self, capacity: MemoryLayout<sockaddr_un>.size) { dst in
                strncpy(dst, src, 104 - 1)
            }
        }
    }

    let bindResult = withUnsafePointer(to: &addr) { ptr in
        ptr.withMemoryRebound(to: sockaddr.self, capacity: 1) { sockPtr in
            bind(serverFd, sockPtr, socklen_t(MemoryLayout<sockaddr_un>.size))
        }
    }

    if bindResult == 0 {
        if listen(serverFd, 5) == 0 { return serverFd }
        close(serverFd)
        unlink(socketPath)
        return -1
    }

    // EADDRINUSE — socket file exists. Check if it's stale.
    close(serverFd)
    if sendToExistingInstance(ProcessInfo.processInfo.arguments) {
        exit(0)
    }

    // Socket is stale (connect failed) — remove and retry bind
    unlink(socketPath)
    let retryFd = socket(AF_UNIX, SOCK_STREAM, 0)
    guard retryFd >= 0 else { return -1 }

    let retryBind = withUnsafePointer(to: &addr) { ptr in
        ptr.withMemoryRebound(to: sockaddr.self, capacity: 1) { sockPtr in
            bind(retryFd, sockPtr, socklen_t(MemoryLayout<sockaddr_un>.size))
        }
    }

    if retryBind == 0 {
        if listen(retryFd, 5) == 0 { return retryFd }
        close(retryFd)
        unlink(socketPath)
        return -1
    }

    close(retryFd)
    return -1
}

/// Start listening on the given server fd for incoming file requests.
func startSocketListener(serverFd: Int32, delegate: AppDelegate) {
    let source = DispatchSource.makeReadSource(fileDescriptor: serverFd, queue: .main)
    delegate.socketSource = source
    source.setEventHandler {
        let clientFd = accept(serverFd, nil, nil)
        guard clientFd >= 0 else { return }

        DispatchQueue.global(qos: .userInitiated).async {
            var data = Data()
            var buffer = [UInt8](repeating: 0, count: 4096)
            while true {
                let bytesRead = read(clientFd, &buffer, buffer.count)
                if bytesRead <= 0 { break }
                data.append(contentsOf: buffer[0..<bytesRead])
            }
            close(clientFd)

            guard !data.isEmpty,
                  let payload = try? JSONDecoder().decode(FileRequestPayload.self, from: data) else { return }

            DispatchQueue.main.async {
                delegate.showFile(FileRequest(path: payload.path, startLine: payload.startLine, endLine: payload.endLine))
            }
        }
    }
    source.setCancelHandler {
        close(serverFd)
        unlink(socketPath)
    }
    source.resume()

    atexit { unlink(socketPath) }
}

// MARK: - Main Entry Point

let args = ProcessInfo.processInfo.arguments

// Try to connect to an existing instance first
if sendToExistingInstance(Array(args)) {
    exit(0)
}

// No existing instance — try to become primary by binding the socket
let serverFd = tryBindSocket()
if serverFd < 0 {
    // Lost the race — another instance bound between our connect and bind.
    // Give it a moment to start listening, then retry.
    usleep(100_000)
    if sendToExistingInstance(Array(args)) {
        exit(0)
    }
    // Give up gracefully — don't spawn a second UI
    exit(0)
}

let app = NSApplication.shared
let delegate = AppDelegate()
app.delegate = delegate

startSocketListener(serverFd: serverFd, delegate: delegate)

app.run()
