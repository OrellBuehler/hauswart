import shared
import SwiftUI
import UIKit

/// Files that were fetched to be opened or shared live in the temporary directory, one at a time.
enum CacheFiles {
    /// Writes `file` (replacing what an earlier open left there) and returns where it is, or nil when it cannot be written.
    static func write(_ file: FilePayload) -> URL? {
        guard let data = Data(base64Encoded: file.base64()) else { return nil }
        let manager = FileManager.default
        let directory = manager.temporaryDirectory.appendingPathComponent("shared", isDirectory: true)
        do {
            if manager.fileExists(atPath: directory.path) {
                try manager.removeItem(at: directory)
            }
            try manager.createDirectory(at: directory, withIntermediateDirectories: true)
            let url = directory.appendingPathComponent(safeName(file.name))
            try data.write(to: url, options: .atomic)
            return url
        } catch {
            return nil
        }
    }

    private static func safeName(_ name: String) -> String {
        let cleaned = name.map { character -> Character in
            "/\\:".contains(character) ? "_" : character
        }
        let text = String(cleaned).trimmingCharacters(in: .whitespacesAndNewlines)
        return text.isEmpty ? "file" : text
    }
}

/// A file ready for the share sheet.
struct SharedFile: Identifiable {
    let id = UUID()
    let url: URL
}

struct ShareSheet: UIViewControllerRepresentable {
    let url: URL

    func makeUIViewController(context: Context) -> UIActivityViewController {
        UIActivityViewController(activityItems: [url], applicationActivities: nil)
    }

    func updateUIViewController(_ controller: UIActivityViewController, context: Context) {}
}

/// A small preview picture that is fetched when the row first appears. `version` is the shared
/// state's thumbnail counter: when it changes the picture is asked for again.
struct ThumbImage: View {
    let version: Int32
    let placeholder: String
    let width: CGFloat
    let height: CGFloat
    let request: () -> Void
    let load: () -> String?

    @State private var image: UIImage? = nil

    init(
        version: Int32,
        placeholder: String,
        width: CGFloat,
        height: CGFloat,
        request: @escaping () -> Void,
        load: @escaping () -> String?
    ) {
        self.version = version
        self.placeholder = placeholder
        self.width = width
        self.height = height
        self.request = request
        self.load = load
    }

    var body: some View {
        ZStack {
            RoundedRectangle(cornerRadius: 8)
                .fill(Color.secondary.opacity(0.15))
            if let image {
                Image(uiImage: image)
                    .resizable()
                    .scaledToFill()
            } else {
                Image(systemName: placeholder)
                    .foregroundStyle(.secondary)
            }
        }
        .frame(width: width, height: height)
        .clipShape(RoundedRectangle(cornerRadius: 8))
        .onAppear {
            request()
            refresh()
        }
        .onChange(of: version) { _, _ in
            refresh()
        }
    }

    private func refresh() {
        guard image == nil, let text = load(), let data = Data(base64Encoded: text) else { return }
        image = UIImage(data: data)
    }
}

/// Re-encodes image data of any kind the photo library hands out (HEIC included) as JPEG, which the server takes.
enum PickedImages {
    static func jpeg(from data: Data) -> Data? {
        guard let image = UIImage(data: data) else { return nil }
        return image.jpegData(compressionQuality: 0.9)
    }

    /// A name for a photo that was taken or picked from the library.
    static func photoName() -> String {
        "photo-\(Int(Date().timeIntervalSince1970)).jpg"
    }
}

/// The camera, presented full screen. `onImage` gets the photo as JPEG data.
struct CameraPicker: UIViewControllerRepresentable {
    let onImage: (Data) -> Void
    let onCancel: () -> Void

    func makeUIViewController(context: Context) -> UIImagePickerController {
        let picker = UIImagePickerController()
        picker.sourceType = .camera
        picker.delegate = context.coordinator
        return picker
    }

    func updateUIViewController(_ controller: UIImagePickerController, context: Context) {}

    func makeCoordinator() -> Coordinator {
        Coordinator(self)
    }

    final class Coordinator: NSObject, UIImagePickerControllerDelegate, UINavigationControllerDelegate {
        private let parent: CameraPicker

        init(_ parent: CameraPicker) {
            self.parent = parent
        }

        func imagePickerController(
            _ picker: UIImagePickerController,
            didFinishPickingMediaWithInfo info: [UIImagePickerController.InfoKey: Any]
        ) {
            if let image = info[.originalImage] as? UIImage, let data = image.jpegData(compressionQuality: 0.9) {
                parent.onImage(data)
            } else {
                parent.onCancel()
            }
        }

        func imagePickerControllerDidCancel(_ picker: UIImagePickerController) {
            parent.onCancel()
        }
    }
}
