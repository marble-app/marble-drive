import Cocoa
import Quartz
import UniformTypeIdentifiers

@objc(PreviewProvider)
final class PreviewProvider: QLPreviewProvider, QLPreviewingController {
    func providePreview(for request: QLFilePreviewRequest) async throws -> QLPreviewReply {
        let data = try Data(contentsOf: request.fileURL)
        return QLPreviewReply(
            dataOfContentType: .html,
            contentSize: CGSize(width: 1024, height: 768)
        ) { reply in
            reply.stringEncoding = .utf8
            return data
        }
    }
}
