import Foundation

enum OpenTarget: Equatable {
    case host(String)
    case localHtml
}

/// Same unreserved set as JavaScript's encodeURIComponent: alphanumerics plus -_.!~*'()
private let encodeURIComponentAllowed = CharacterSet(charactersIn:
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_.!~*'()"
)

func encodeURIComponent(_ value: String) -> String {
    value.addingPercentEncoding(withAllowedCharacters: encodeURIComponentAllowed) ?? value
}

func openTarget(filePath: String, driveRoot: String, host: String) -> OpenTarget {
    let file = (filePath as NSString).standardizingPath
    var root = (driveRoot as NSString).standardizingPath
    while root.hasSuffix("/") { root.removeLast() }

    let rootPrefix = root + "/"
    guard file == root || file.hasPrefix(rootPrefix) else { return .localHtml }

    var relative = String(file.dropFirst(rootPrefix.count))
    if relative.lowercased().hasSuffix(".mrbl") {
        relative = String(relative.dropLast(5))
    }
    guard !relative.isEmpty else { return .localHtml }

    var base = host
    while base.hasSuffix("/") { base.removeLast() }
    return .host("\(base)/a/\(encodeURIComponent(relative))")
}
