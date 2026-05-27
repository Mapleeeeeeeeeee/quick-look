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
    override func mouseDown(with event: NSEvent) {
        window?.performDrag(with: event)
    }
}

// Parses CLI arguments into a (path, startLine, endLine) tuple.
// Used by both AppDelegate and sendToExistingInstance so the logic lives in one place.
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
            panel.orderOut(nil)
        }
    }

    func applicationDidFinishLaunching(_ notification: Notification) {
        NSApp.setActivationPolicy(.accessory)

        setupPanel()

        let args = ProcessInfo.processInfo.arguments
        if let request = parseArgs(Array(args)) {
            showFile(request)
        }

        DistributedNotificationCenter.default().addObserver(
            self,
            selector: #selector(handleNewFileRequest(_:)),
            name: NSNotification.Name("com.copilot-preview.open-file"),
            object: nil
        )
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
            webView.loadFileURL(indexURL, allowingReadAccessTo: URL(fileURLWithPath: NSHomeDirectory()))
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
                            delegate.panel.orderOut(nil)
                        }
                        return nil
                    }
                    return Unmanaged.passRetained(event)
                }

                if keycode == 50 {
                    DispatchQueue.main.async { delegate.panel.orderOut(nil) }
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

    func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
    }

    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
    }

    @objc func handleNewFileRequest(_ notification: Notification) {
        guard let userInfo = notification.userInfo,
              let filePath = userInfo["path"] as? String else { return }
        let startLine = userInfo["startLine"] as? Int
        let endLine = userInfo["endLine"] as? Int
        showFile(FileRequest(path: filePath, startLine: startLine, endLine: endLine))
    }
}

var lockFd: Int32 = -1

func acquireLock() -> Bool {
    let lockPath = "/tmp/copilot-preview.lock"
    let fd = open(lockPath, O_CREAT | O_RDWR, 0o644)
    guard fd >= 0 else { return false }
    if flock(fd, LOCK_EX | LOCK_NB) == 0 {
        lockFd = fd
        return true
    }
    close(fd)
    return false
}

func sendToExistingInstance(_ args: [String]) {
    let (path, startLine, endLine) = parseArguments(args)
    guard let p = path else { return }

    var userInfo: [String: Any] = ["path": p]
    if let s = startLine { userInfo["startLine"] = s }
    if let e = endLine { userInfo["endLine"] = e }

    // Known limitation: if the first instance hasn't finished launching
    // (observer not yet registered), this notification will be silently dropped.
    // Acceptable for a local preview tool; for production reliability,
    // consider file-based IPC with DispatchSourceFileSystemObject.
    DistributedNotificationCenter.default().postNotificationName(
        NSNotification.Name("com.copilot-preview.open-file"),
        object: nil,
        userInfo: userInfo,
        deliverImmediately: true
    )
}

let args = ProcessInfo.processInfo.arguments

if !acquireLock() {
    sendToExistingInstance(Array(args))
    exit(0)
}

let app = NSApplication.shared
let delegate = AppDelegate()
app.delegate = delegate
app.run()
