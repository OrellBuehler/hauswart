import PhotosUI
import shared
import SwiftUI
import UniformTypeIdentifiers

/// What the receipt form holds besides the file, as Swift values the fields bind to.
struct ReceiptFields {
    var note = ""
    var bookId = ""
    var assetId = ""

    var kotlin: ReceiptForm {
        ReceiptForm(note: note, bookId: bookId, assetId: assetId)
    }
}

/// Takes a photo of a receipt (or picks a picture or PDF) and puts it in the queue. Presented as a sheet.
struct ReceiptSubmitScreen: View {
    @StateObject private var model = Observed(ReceiptSubmitStore(app: AppEnv.app))
    @Environment(\.dismiss) private var dismiss

    @State private var fields = ReceiptFields()
    @State private var choosingPhoto = false
    @State private var choosingFile = false
    @State private var takingPhoto = false
    @State private var photoItem: PhotosPickerItem? = nil

    var body: some View {
        let state = model.state
        NavigationStack {
            content(state)
                .navigationTitle(tr("receipts_submit"))
                .navigationBarTitleDisplayMode(.inline)
                .toolbar {
                    ToolbarItem(placement: .cancellationAction) {
                        Button(tr("common_cancel")) { dismiss() }
                    }
                    if state.createdId == nil, !state.undone {
                        ToolbarItem(placement: .confirmationAction) {
                            Button(state.saving ? tr("quick_receipt_sending") : tr("quick_receipt_submit")) {
                                model.store.submit(form: fields.kotlin)
                            }
                            .disabled(state.saving || state.loading || state.fileProblem != nil)
                        }
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
                                    usePhoto(data)
                                } else {
                                    model.store.rejectUnreadable()
                                }
                            case .failure:
                                model.store.rejectUnreadable()
                            }
                        }
                    }
                }
                .fileImporter(
                    isPresented: $choosingFile,
                    allowedContentTypes: [.pdf, .image],
                    allowsMultipleSelection: false
                ) { result in
                    switch result {
                    case let .success(urls):
                        if let url = urls.first { importFile(url) }
                    case .failure:
                        model.store.rejectUnreadable()
                    }
                }
                .fullScreenCover(isPresented: $takingPhoto) {
                    CameraPicker(
                        onImage: { data in
                            takingPhoto = false
                            model.store.pickFileEncoded(
                                name: PickedImages.photoName(),
                                mime: "image/jpeg",
                                base64: data.base64EncodedString()
                            )
                        },
                        onCancel: { takingPhoto = false }
                    )
                    .ignoresSafeArea()
                }
        }
    }

    @ViewBuilder
    private func content(_ state: ReceiptSubmitState) -> some View {
        if let error = state.loadError {
            ErrorView(error: error) { model.store.retry() }
        } else if state.loading {
            LoadingView()
        } else if state.createdId != nil || state.undone {
            sent(state)
        } else {
            form(state)
        }
    }

    private func sent(_ state: ReceiptSubmitState) -> some View {
        Form {
            Section {
                Text(tr(state.undone ? "quick_receipt_undone_toast" : "quick_receipt_sent_toast"))
                    .font(.headline)
                if let error = state.error {
                    Text(error)
                        .font(.footnote)
                        .foregroundStyle(.red)
                }
            }
            Section {
                if !state.undone {
                    Button(tr("common_undo")) { model.store.undo() }
                }
                Button(tr("quick_receipt_another")) {
                    fields.note = ""
                    model.store.reset()
                }
            }
        }
    }

    private func form(_ state: ReceiptSubmitState) -> some View {
        let errors = state.fieldErrors
        return Form {
            Section {
                Text(tr("quick_receipt_explainer"))
                    .font(.footnote)
                    .foregroundStyle(.secondary)
            }
            Section {
                Menu {
                    if UIImagePickerController.isSourceTypeAvailable(.camera) {
                        Button {
                            takingPhoto = true
                        } label: {
                            Label(tr("quick_receipt_camera"), systemImage: "camera")
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
                    Label(state.fileName == nil ? tr("quick_receipt_file") : tr("m_receipts_replace"), systemImage: "camera.viewfinder")
                }
                if let name = state.fileName {
                    HStack {
                        Text(name)
                            .lineLimit(1)
                        Spacer()
                        if let size = state.fileSizeText {
                            Text(size)
                                .font(.footnote)
                                .foregroundStyle(.secondary)
                        }
                    }
                    Button(tr("quick_receipt_remove"), role: .destructive) { model.store.clearFile() }
                        .buttonStyle(.borderless)
                } else {
                    Text(tr("m_receipts_file_none"))
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                }
                FieldError(text: state.fileProblem)
                if let warning = state.fileWarning {
                    Text(warning)
                        .font(.footnote)
                        .foregroundStyle(.orange)
                }
                if state.fileProblem == nil {
                    FieldError(text: errors["file"])
                }
            }
            Section {
                TextEntry(label: tr("quick_receipt_note"), text: $fields.note, error: errors["note"], multiline: true)
            } footer: {
                Text(tr("quick_receipt_note_hint"))
            }
            Section {
                if !state.books.isEmpty {
                    ChoiceEntry(
                        label: tr("cost_book"),
                        selection: $fields.bookId,
                        options: state.books.map { Choice(value: $0.value, label: $0.label) }
                    )
                }
                ChoiceEntry(
                    label: tr("cost_asset"),
                    selection: $fields.assetId,
                    options: state.assets.map { Choice(value: $0.value, label: $0.label) }
                )
            } footer: {
                if !state.books.isEmpty {
                    Text(tr("quick_receipt_book_hint"))
                }
            }
            if let error = state.error {
                Section {
                    Text(error)
                        .font(.footnote)
                        .foregroundStyle(.red)
                    if state.noAnswer {
                        Text(tr("quick_receipt_check_list"))
                            .font(.footnote)
                    }
                }
            }
        }
    }

    private func usePhoto(_ data: Data) {
        guard let jpeg = PickedImages.jpeg(from: data) else {
            model.store.rejectUnreadable()
            return
        }
        model.store.pickFileEncoded(name: PickedImages.photoName(), mime: "image/jpeg", base64: jpeg.base64EncodedString())
    }

    private func importFile(_ url: URL) {
        let scoped = url.startAccessingSecurityScopedResource()
        defer {
            if scoped { url.stopAccessingSecurityScopedResource() }
        }
        let name = url.lastPathComponent
        let values = try? url.resourceValues(forKeys: [.fileSizeKey])
        let size = Int64(values?.fileSize ?? 0)
        if model.store.rejectIfTooLarge(name: name, size: size) { return }
        guard let data = try? Data(contentsOf: url) else {
            model.store.rejectUnreadable()
            return
        }
        let ext = url.pathExtension.lowercased()
        if ext == "heic" || ext == "heif" {
            guard let jpeg = PickedImages.jpeg(from: data) else {
                model.store.rejectUnreadable()
                return
            }
            let base = url.deletingPathExtension().lastPathComponent
            model.store.pickFileEncoded(name: base + ".jpg", mime: "image/jpeg", base64: jpeg.base64EncodedString())
        } else {
            model.store.pickFileEncoded(name: name, mime: nil, base64: data.base64EncodedString())
        }
    }
}
