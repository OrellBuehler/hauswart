import QuickLook
import shared
import SwiftUI

/// The documents of the person's document system that are linked to one owner, as a section of a
/// `List` (or `Form`): open the preview, share the original, unlink, and link another one by
/// searching. Shows nothing at all when the person has no document system connected and nothing
/// is linked.
///
///     DocumentLinksSection(ownerType: "asset", ownerId: asset.id)
///
/// `ownerType` is asset, room, page, task, defect, service_log, part, contact, cost or
/// insurance_policy. It loads and refreshes itself and reports `documents` changes through the app.
struct DocumentLinksSection: View {
    private let ownerType: String
    private let ownerId: String
    @StateObject private var model: Observed<DocumentLinksStore, DocumentLinksState>
    @State private var linking = false

    init(ownerType: String, ownerId: String) {
        self.ownerType = ownerType
        self.ownerId = ownerId
        _model = StateObject(wrappedValue: Observed(DocumentLinksStore(app: AppEnv.app, ownerType: ownerType, ownerId: ownerId)))
    }

    var body: some View {
        sectionView(model.state)
    }

    @ViewBuilder
    private func sectionView(_ state: DocumentLinksState) -> some View {
        if state.visible {
            Section {
                if let error = state.error {
                    VStack(alignment: .leading, spacing: 8) {
                        Text(error.message)
                            .foregroundStyle(.red)
                        Button(tr("common_retry")) { model.store.refresh() }
                            .buttonStyle(.borderless)
                    }
                }
                ErrorBanner(error: state.actionError)
                if state.rows.isEmpty && state.error == nil {
                    Text(state.canLink ? tr("document_links_empty_body") : tr("document_links_empty_readonly"))
                        .foregroundStyle(.secondary)
                }
                ForEach(state.rows, id: \.id) { row in
                    DocumentLinkRowView(row: row, state: state, store: model.store)
                }
                if state.canLink {
                    Button {
                        linking = true
                    } label: {
                        Label(tr("document_link_add"), systemImage: "plus")
                    }
                    .buttonStyle(.borderless)
                    .sheet(isPresented: $linking) {
                        LinkDocumentSheet(ownerType: ownerType, ownerId: ownerId)
                    }
                }
            } header: {
                Text(tr("document_links_title"))
            }
        }
    }
}

private struct DocumentLinkRowView: View {
    let row: DocumentLinkRow
    let state: DocumentLinksState
    let store: DocumentLinksStore

    @State private var preview: URL? = nil
    @State private var sharedFile: SharedFile? = nil
    @State private var confirmingUnlink = false
    @State private var notice: String? = nil

    var body: some View {
        let busy = state.opening == row.id || state.unlinkingId == row.id
        VStack(alignment: .leading, spacing: 4) {
            HStack(spacing: 12) {
                Button {
                    if row.canOpen { store.open(id: row.id) }
                } label: {
                    HStack(spacing: 12) {
                        ThumbImage(
                            version: state.thumbs,
                            placeholder: row.available ? "doc.text" : "lock",
                            width: 36,
                            height: 48,
                            request: { if row.hasThumb { store.requestThumbnail(id: row.id) } },
                            load: { row.hasThumb ? store.thumbnailBase64(id: row.id) : nil }
                        )
                        VStack(alignment: .leading, spacing: 2) {
                            Text(row.title)
                                .lineLimit(2)
                                .foregroundStyle(row.available ? Color.primary : Color.secondary)
                            Badge(text: row.roleLabel)
                            Text(row.available ? row.details : tr("document_unavailable_hint"))
                                .font(.footnote)
                                .foregroundStyle(.secondary)
                                .lineLimit(2)
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
        .confirmDelete(
            tr("document_unlink_title"),
            message: row.available ? tr("document_unlink_description", ["title": row.title]) : tr("document_unlink_description_unavailable"),
            isPresented: $confirmingUnlink
        ) {
            store.unlink(id: row.id)
        }
        .onChange(of: state.opened?.linkId == row.id) { _, pending in
            if pending { consumeOpened() }
        }
    }

    private var menu: some View {
        Menu {
            if row.canOpen {
                Button {
                    store.open(id: row.id)
                } label: {
                    Label(tr("document_open_preview"), systemImage: "eye")
                }
                Button {
                    store.openOriginal(id: row.id)
                } label: {
                    Label(tr("document_download_original"), systemImage: "square.and.arrow.up")
                }
            }
            Button(role: .destructive) {
                confirmingUnlink = true
            } label: {
                Label(tr("document_unlink"), systemImage: "link.badge.minus")
            }
        } label: {
            Image(systemName: "ellipsis.circle")
        }
        .buttonStyle(.borderless)
        .accessibilityLabel(tr("document_actions_aria", ["title": row.title]))
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
