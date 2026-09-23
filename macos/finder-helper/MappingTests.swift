import Foundation

@main
enum MappingTests {
    static func main() {
        var failed = 0
        func check(_ name: String, _ ok: Bool, _ detail: String = "") {
            if ok {
                print("ok  \(name)")
            } else {
                failed += 1
                print("not ok  \(name)\(detail.isEmpty ? "" : " — \(detail)")")
            }
        }

        let root = "/Users/bryan/drive"
        let host = "https://bryans-macbook-pro.tail3668e0.ts.net"

        let nested = openTarget(
            filePath: "\(root)/work/q3/notes.mrbl",
            driveRoot: root,
            host: host
        )
        check(
            "a document in a nested folder maps to /a/ with slashes encoded",
            nested == .host("\(host)/a/work%2Fq3%2Fnotes"),
            "got \(nested)"
        )

        let apostrophe = openTarget(
            filePath: "\(root)/Bryan's Days/today.mrbl",
            driveRoot: root,
            host: host
        )
        check(
            "spaces encode and apostrophes stay, matching encodeURIComponent",
            apostrophe == .host("\(host)/a/Bryan's%20Days%2Ftoday"),
            "got \(apostrophe)"
        )

        let trailingHost = openTarget(
            filePath: "\(root)/notes.mrbl",
            driveRoot: root,
            host: host + "/"
        )
        check(
            "a trailing slash on the host is not doubled",
            trailingHost == .host("\(host)/a/notes"),
            "got \(trailingHost)"
        )

        let upperExt = openTarget(
            filePath: "\(root)/notes.MRBL",
            driveRoot: root,
            host: host
        )
        check(
            "the extension is stripped case-insensitively",
            upperExt == .host("\(host)/a/notes"),
            "got \(upperExt)"
        )

        let outside = openTarget(
            filePath: "/Users/bryan/Desktop/Seattle Move Out.mrbl",
            driveRoot: root,
            host: host
        )
        check(
            "a file outside the drive is opened as local HTML, not a host URL",
            outside == .localHtml,
            "got \(outside)"
        )

        let cousin = openTarget(
            filePath: "/Users/bryan/drive-other/notes.mrbl",
            driveRoot: root,
            host: host
        )
        check(
            "a path that only shares a prefix with the drive root is not inside it",
            cousin == .localHtml,
            "got \(cousin)"
        )

        let rootSlash = openTarget(
            filePath: "\(root)/notes.mrbl",
            driveRoot: root + "/",
            host: host
        )
        check(
            "a trailing slash on the drive root still matches",
            rootSlash == .host("\(host)/a/notes"),
            "got \(rootSlash)"
        )

        let unset = openTarget(
            filePath: "/Users/someone/Desktop/notes.mrbl",
            driveRoot: "",
            host: host
        )
        check(
            "with no drive configured, nothing is inside a drive",
            unset == .localHtml,
            "got \(unset)"
        )

        if failed > 0 {
            fputs("\(failed) failed\n", stderr)
            exit(1)
        }
        print("all passed")
    }
}
