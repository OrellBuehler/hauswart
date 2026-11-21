import PhotosUI
import QuickLook
import shared
import SwiftUI
import UniformTypeIdentifiers

/// The files of one owner as a section of a `List` (or `Form`): thumbnails (loaded lazily), upload
/// from the camera, the photo library or the file picker, open in the system preview (zoom
/// included), share, caption, guest visibility where the owner has it, delete.
///
///     AttachmentsSection(ownerType: "task", ownerId: task.id)
///
/// `ownerType` is the attachment owner type: asset, room, page, task, defect, service_log, part,
/// asset_hint, contact, cost, insurance_policy, asset_note, tire_set or appointment. It loads and
/// refreshes itself and reports `attachments` changes through the app.
struct AttachmentsSection: View {
    @StateObject private var model: Observed<AttachmentsStore, AttachmentsState>
    @State private var choosingPhoto = false
    @State private var choosingFile = false
    @State private var takingPhoto = false
    @State private var photoItem: PhotosPickerItem? = nil
    @State private var notice: String? = nil

    init(ownerType: String, ownerId: String) {
        _model = StateObject(wrappedValue: Observed(AttachmentsStore(app: AppEnv.app, ownerType: ownerType, ownerId: ownerId)))
    }

    var body: some View {
        let state = model.state
        Section {
            addRow(state)
            ForEach(state.uploads, id: \.id) { upload in
                UploadItemView(
                    upload: upload,
                    retry: { model.store.retryUpload(id: upload.id) },
                    dismiss: { model.store.dismissUpload(id: upload.id) }
                )
            }
            if state.loading {
                ProgressView()
                    .frame(maxWidth: .infinity)
            } else if let error = state.error, state.rows.isEmpty {
                VStack(alignment: .leading, spacing: 8) {
                    Text(error.message)
                        .foregroundStyle(.red)
                    Button(tr("common_retry")) { model.store.refresh() }
                        .buttonStyle(.borderless)
                }
            } else if state.rows.isEmpty && state.uploads.isEmpty {
                Text(tr("attach_empty_title"))
                    .foregroundStyle(.secondary)
            }
            ForEach(state.rows, id: \.id) { row in
                AttachmentRowView(row: row, state: state, store: model.store)
            }
        } header: {
            Text(tr("attach_title"))
        }
    }

    @ViewBuilder
    private func addRow(_ state: AttachmentsState) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Menu {
                if UIImagePickerController.isSourceTypeAvailable(.camera) {
                    Button {
                        takingPhoto = true
                    } label: {
                        Label(tr("attach_take_photo"), systemImage: "camera")
                    }
                }
                Button {
                    choosingPhoto = true
                } label: {
                    Label(tr("m_attach_from_library"), systemImage: "photo.on.rectangle")
                }
                Button {
                    choosingFile = true
                } label: {
                    Label(tr("attach_choose_file"), systemImage: "doc")
                }
            } label: {
                Label(tr("m_attach_add"), systemImage: "paperclip")
            }
            if let error = state.actionError {
                ErrorBanner(error: error)
            }
            if let notice {
                Text(notice)
                    .font(.footnote)
                    .foregroundStyle(.red)
            }
        }
        .photosPicker(isPresented: $choosingPhoto, selection: $photoItem, matching: .images)
        .onChange(of: photoItem) { _, item in
            guard let item else { return }
            photoItem = nil
            _ = item.loadTransferable(type: Data.self) { result in
                DispatchQueue.main.async {
                    switch result {
                    case let .success(value):
                        if let data = value {
                            uploadPhoto(data)
                        } else {
                            notice = tr("m_attach_cannot_read")
                        }
                    case .failure:
                        notice = tr("m_attach_cannot_read")
                    }
                }
            }
        }
        .fileImporter(isPresented: $choosingFile, allowedContentTypes: [.pdf, .image], allowsMultipleSelection: false) { result in
            switch result {
            case let .success(urls):
                if let url = urls.first { importFile(url) }
            case .failure:
                notice = tr("m_attach_cannot_read")
            }
        }
        .fullScreenCover(isPresented: $takingPhoto) {
            CameraPicker(
                onImage: { data in
                    takingPhoto = false
                    send(PickedImages.photoName(), data)
                },
                onCancel: { takingPhoto = false }
            )
            .ignoresSafeArea()
        }
    }

    private func uploadPhoto(_ data: Data) {
        notice = nil
        guard let jpeg = PickedImages.jpeg(from: data) else {
            notice = tr("m_attach_cannot_read")
            return
        }
        send(PickedImages.photoName(), jpeg)
    }

    private func importFile(_ url: URL) {
        notice = nil
        let scoped = url.startAccessingSecurityScopedResource()
        defer {
            if scoped { url.stopAccessingSecurityScopedResource() }
        }
        let name = url.lastPathComponent
        let values = try? url.resourceValues(forKeys: [.fileSizeKey])
        let size = Int64(values?.fileSize ?? 0)
        if model.store.rejectIfTooLarge(name: name, size: size) { return }
        guard let data = try? Data(contentsOf: url) else {
            notice = tr("m_attach_cannot_read")
            return
        }
        let ext = url.pathExtension.lowercased()
        if ext == "heic" || ext == "heif" {
            guard let jpeg = PickedImages.jpeg(from: data) else {
                notice = tr("m_attach_cannot_read")
                return
            }
            let base = url.deletingPathExtension().lastPathComponent
            send(base + ".jpg", jpeg)
        } else {
            model.store.uploadEncoded(name: name, mime: nil, base64: data.base64EncodedString())
        }
    }

    private func send(_ name: String, _ data: Data) {
        model.store.uploadEncoded(name: name, mime: "image/jpeg", base64: data.base64EncodedString())
    }
}

private struct UploadItemView: View {
    let upload: AttachmentUploadRow
    let retry: () -> Void
    let dismiss: () -> Void

    var body: some View {
        HStack(spacing: 12) {
            if upload.failed {
                Image(systemName: "exclamationmark.triangle")
                    .foregroundStyle(.red)
            } else {
                ProgressView()
            }
            VStack(alignment: .leading, spacing: 2) {
                Text(upload.name)
                    .lineLimit(1)
                Text(upload.failed ? upload.error : tr("m_attach_uploading"))
                    .font(.footnote)
                    .foregroundStyle(upload.failed ? Color.red : Color.secondary)
            }
            Spacer(minLength: 0)
            if upload.failed {
                if upload.canRetry {
                    Button(action: retry) {
                        Image(systemName: "arrow.clockwise")
                    }
                    .buttonStyle(.borderless)
                    .accessibilityLabel(tr("m_attach_retry"))
                }
                Button(action: dismiss) {
                    Image(systemName: "xmark")
                }
                .buttonStyle(.borderless)
                .accessibilityLabel(tr("m_attach_dismiss"))
            }
        }
    }
}

private struct AttachmentRowView: View {
    let row: AttachmentRow
    let state: AttachmentsState
    let store: AttachmentsStore

    @State private var preview: URL? = nil
    @State private var sharedFile: SharedFile? = nil
    @State private var editingCaption = false
    @State private var confirmingDelete = false
    @State private var notice: String? = nil

    var body: some View {
        let busy = state.busyId == row.id || state.opening == row.id
        VStack(alignment: .leading, spacing: 4) {
            HStack(spacing: 12) {
                Button {
                    store.open(id: row.id)
                } label: {
                    HStack(spacing: 12) {
                        ThumbImage(
                            version: state.thumbs,
                            placeholder: placeholder,
                            width: 48,
                            height: 48,
                            request: { if row.hasThumb { store.requestThumbnail(id: row.id) } },
                            load: { row.hasThumb ? store.thumbnailBase64(id: row.id) : nil }
                        )
                        VStack(alignment: .leading, spacing: 2) {
                            Text(row.label)
                                .lineLimit(2)
                            Text(subtitle)
                                .font(.footnote)
                                .foregroundStyle(.secondary)
                                .lineLimit(1)
                        }
                    }
                }
                .buttonStyle(.plain)
                Spacer(minLength: 0)
                if busy {
                    ProgressView()
                } else {
                    menu
                }
            }
            if let notice {
                Text(notice)
                    .font(.footnote)
                    .foregroundStyle(.red)
            }
        }
        .quickLookPreview($preview)
        .sheet(item: $sharedFile) { file in
            ShareSheet(url: file.url)
        }
        .sheet(isPresented: $editingCaption) {
            CaptionSheet(row: row, state: state, store: store, isPresented: $editingCaption)
        }
        .confirmDelete(
            tr("attach_delete_title"),
            message: tr("attach_delete_description", ["name": row.label]),
            isPresented: $confirmingDelete
        ) {
            store.delete(id: row.id)
        }
        .onChange(of: state.opened?.attachmentId == row.id) { _, pending in
            if pending { consumeOpened() }
        }
        .onChange(of: state.captioned) { _, _ in
            editingCaption = false
        }
    }

    private var menu: some View {
        Menu {
            Button {
                store.open(id: row.id)
            } label: {
                Label(tr("m_attach_open"), systemImage: "eye")
            }
            Button {
                store.share(id: row.id)
            } label: {
                Label(tr("m_attach_share"), systemImage: "square.and.arrow.up")
            }
            Button {
                editingCaption = true
            } label: {
                Label(tr("attach_edit_caption"), systemImage: "pencil")
            }
            if state.guestOwner {
                Button {
                    store.setGuestVisible(id: row.id, visible: !row.guestVisible)
                } label: {
                    Label(tr("attach_guest_visible"), systemImage: row.guestVisible ? "checkmark.circle.fill" : "circle")
                }
            }
            Button(role: .destructive) {
                confirmingDelete = true
            } label: {
                Label(tr("common_delete"), systemImage: "trash")
            }
        } label: {
            Image(systemName: "ellipsis.circle")
        }
        .buttonStyle(.borderless)
        .accessibilityLabel(tr("attach_actions_aria", ["name": row.label]))
    }

    private var placeholder: String {
        switch row.kind {
        case "image": return "photo"
        case "pdf": return "doc.richtext"
        default: return "doc"
        }
    }

    private var subtitle: String {
        row.guestVisible ? row.sizeText + " · " + tr("attach_guest_badge") : row.sizeText
    }

    private func consumeOpened() {
        guard let opened = state.opened else { return }
        store.clearOpened()
        guard let url = CacheFiles.write(opened.file) else {
            notice = tr("m_cannot_open")
            return
        }
        notice = nil
        if opened.share {
            sharedFile = SharedFile(url: url)
        } else {
            preview = url
        }
    }
}

private struct CaptionSheet: View {
    let row: AttachmentRow
    let state: AttachmentsState
    let store: AttachmentsStore
    @Binding var isPresented: Bool
    @State private var caption: String

    init(row: AttachmentRow, state: AttachmentsState, store: AttachmentsStore, isPresented: Binding<Bool>) {
        self.row = row
        self.state = state
        self.store = store
        _isPresented = isPresented
        _caption = State(initialValue: row.caption)
    }

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    TextEntry(
                        label: tr("attach_caption_label"),
                        text: $caption,
                        error: state.captionError,
                        multiline: true
                    )
                }
            }
            .navigationTitle(tr("attach_edit_caption"))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button(tr("common_cancel")) { isPresented = false }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button(state.captionSaving ? tr("common_saving") : tr("common_save")) {
                        store.saveCaption(id: row.id, caption: caption)
                    }
                    .disabled(state.captionSaving)
                }
            }
        }
    }
}
