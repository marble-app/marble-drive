import AppKit
import CoreServices
import Foundation
import UniformTypeIdentifiers

private let bundleId = "com.bdhmin.marble.finder"
private let typeId = "com.bdhmin.marble.document"

struct FinderConfig: Decodable {
    var driveRoot: String
    var host: String
}

func configURL() -> URL {
    FileManager.default.homeDirectoryForCurrentUser
        .appendingPathComponent("Library/Application Support/Marble/finder.json")
}

func loadConfig() -> FinderConfig {
    let url = configURL()
    if let data = try? Data(contentsOf: url),
       let cfg = try? JSONDecoder().decode(FinderConfig.self, from: data)
    {
        return cfg
    }
    return FinderConfig(
        driveRoot: "/Users/bryanmin/Development/3rd-year-projects/marble-drive/drive",
        host: "https://bryans-macbook-pro.tail3668e0.ts.net"
    )
}

func registerHandler() {
    LSSetDefaultRoleHandlerForContentType(
        typeId as CFString,
        LSRolesMask.all,
        bundleId as CFString
    )
    if let mrbl = UTType(filenameExtension: "mrbl") {
        NSWorkspace.shared.setDefaultApplication(at: Bundle.main.bundleURL, toOpen: mrbl) { error in
            if let error { NSLog("marble: setDefaultApplication: \(error)") }
        }
    }
}

func openLocalHtml(_ file: URL) {
    do {
        let tmp = FileManager.default.temporaryDirectory
            .appendingPathComponent("marble-open-\(ProcessInfo.processInfo.globallyUniqueString)", isDirectory: true)
        try FileManager.default.createDirectory(at: tmp, withIntermediateDirectories: true)
        let dest = tmp.appendingPathComponent(file.deletingPathExtension().lastPathComponent + ".html")
        try FileManager.default.copyItem(at: file, to: dest)
        NSWorkspace.shared.open(dest)
    } catch {
        NSLog("marble: could not open \(file.path) as HTML: \(error)")
    }
}

func logLine(_ message: String) {
    NSLog("marble: \(message)")
    let log = FileManager.default.homeDirectoryForCurrentUser
        .appendingPathComponent("Library/Logs/marble-finder.log")
    let line = "\(ISO8601DateFormatter().string(from: Date())) \(message)\n"
    guard let data = line.data(using: .utf8) else { return }
    if FileManager.default.fileExists(atPath: log.path),
       let handle = try? FileHandle(forWritingTo: log)
    {
        defer { try? handle.close() }
        _ = try? handle.seekToEnd()
        try? handle.write(contentsOf: data)
    } else {
        try? data.write(to: log)
    }
}

func handle(_ url: URL) {
    let cfg = loadConfig()
    let file = url.resolvingSymlinksInPath()
    switch openTarget(filePath: file.path, driveRoot: cfg.driveRoot, host: cfg.host) {
    case .host(let href):
        guard let openURL = URL(string: href) else {
            logLine("bad host URL \(href)")
            return
        }
        logLine("open host \(href)")
        NSWorkspace.shared.open(openURL)
    case .localHtml:
        logLine("open local-html \(file.path)")
        openLocalHtml(file)
    }
}

final class AppDelegate: NSObject, NSApplicationDelegate {
    private var receivedFiles = false

    func application(_ sender: NSApplication, open urls: [URL]) {
        receivedFiles = true
        urls.forEach(handle)
        NSApp.terminate(nil)
    }

    func applicationDidFinishLaunching(_ notification: Notification) {
        registerHandler()
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.4) {
            if !self.receivedFiles { NSApp.terminate(nil) }
        }
    }
}

@main
enum Marble {
    static func main() {
        let args = Array(CommandLine.arguments.dropFirst())
        if args.first == "--map" {
            let cfg = loadConfig()
            for path in args.dropFirst() {
                let url = URL(fileURLWithPath: path).resolvingSymlinksInPath()
                switch openTarget(filePath: url.path, driveRoot: cfg.driveRoot, host: cfg.host) {
                case .host(let href):
                    print("host\t\(href)")
                case .localHtml:
                    print("local-html\t\(url.path)")
                }
            }
            return
        }
        if args.first == "--register" {
            let app = NSApplication.shared
            app.setActivationPolicy(.accessory)
            registerHandler()
            // setDefaultApplication is async; give it a moment.
            RunLoop.current.run(until: Date(timeIntervalSinceNow: 0.5))
            return
        }

        let app = NSApplication.shared
        let delegate = AppDelegate()
        app.delegate = delegate
        app.setActivationPolicy(.accessory)
        withExtendedLifetime(delegate) {
            app.run()
        }
    }
}
