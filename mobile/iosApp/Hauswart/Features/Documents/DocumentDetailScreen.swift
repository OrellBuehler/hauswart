import QuickLook
import shared
import SwiftUI

struct DocumentDetailScreen: View {
    @StateObject private var model: Observed<DocumentDetailStore, DocumentDetailState>
    @Environment(\.openURL) private var openURL
    @State private var preview: URL? = nil
    @State private var sharedFile: SharedFile? = nil
    @State private var unlinkId: String? = nil
    @State private var notice: String? = nil

    init(id: String) {
        _model = StateObject(wrappedValue: Observed(DocumentDetailStore(app: AppEnv.app, externalId: id)))
    }

    var body: some View {
        let state = model.state
        content(state)
            .navigationTitle(state.title.isEmpty ? tr("nav_documents") : state.title)
            .navigationBarTitleDisplayMode(.inline)
            .quickLookPreview($preview)
            .sheet(item: $sharedFile) { file in
                ShareSheet(url: file.url)
            }
            .confirmDelete(
                tr("document_unlink_title"),
                message: tr("document_unlink_description", ["title": state.title]),
                isPresented: Binding(get: { unlinkId != nil }, set: { if !$0 { unlinkId = nil } })
            ) {
                if let id = unlinkId { model.store.unlink(linkId: id) }
            }
            .safeAreaInset(edge: .bottom) {
                if let text = notice ?? state.notice {
                    KnowledgeNoticeBar(text: text) {
                        notice = nil
                        model.store.dismissNotice()
                    }
                } else if let error = state.actionError {
                    KnowledgeNoticeBar(text: error.message) { model.store.dismissActionError() }
                }
            }
            .onChange(of: state.opened != nil) { _, ready in
                if ready { consumeOpened() }
            }
    }

    @ViewBuilder
    private func content(_ state: DocumentDetailState) -> some View {
        if !state.title.isEmpty {
            List {
                Section {
                    HStack(spacing: 16) {
                        ThumbImage(
                            version: state.thumbs,
                            placeholder: "doc.text",
                            width: 72,
                            height: 96,
                            request: { model.store.requestThumbnail() },
                            load: { model.store.thumbnailBase64() }
                        )
                        VStack(alignment: .leading, spacing: 8) {
                            Button {
                                model.store.open()
                            } label: {
                                Label(tr("document_open_preview"), systemImage: "eye")
                            }
                            .buttonStyle(.bordered)
                            Button {
                                model.store.openOriginal()
                            } label: {
                                Label(tr("document_download_original"), systemImage: "square.and.arrow.up")
                            }
                            .buttonStyle(.bordered)
                        }
                        .disabled(state.opening)
                    }
                    if state.opening {
                        ProgressView()
                    }
                }
                Section {
                    ForEach(state.facts, id: \.label) { fact in
                        LabeledContent(fact.label, value: fact.value)
                    }
                    if !state.tags.isEmpty {
                        LabeledContent(tr("documents_field_tags"), value: state.tags.joined(separator: ", "))
                    }
                    if let web = state.webUrl, let url = URL(string: web) {
                        Button(tr("documents_open_in_system")) { openURL(url) }
                    }
                }
                Section(tr("documents_links_title")) {
                    if state.uses.isEmpty {
                        Text(tr("documents_links_none"))
                            .foregroundStyle(.secondary)
                    }
                    ForEach(state.uses, id: \.id) { use in
                        useRow(use, state)
                    }
                }
            }
            .refreshable { model.store.refresh() }
        } else if let error = state.error {
            ErrorView(error: error) { model.store.refresh() }
        } else {
            LoadingView()
        }
    }

    private func useRow(_ use: DocumentUseRow, _ state: DocumentDetailState) -> some View {
        HStack {
            if let link = use.link, let route = Route.from(link: link) {
                NavigationLink(value: route) {
                    useLabel(use)
                }
            } else {
                useLabel(use)
            }
            if state.unlinkingId == use.id {
                ProgressView()
            } else {
                Button {
                    unlinkId = use.id
                } label: {
                    Image(systemName: "link.badge.minus")
                }
                .buttonStyle(.borderless)
                .accessibilityLabel(tr("documents_unlink_aria", ["owner": use.title]))
            }
        }
    }

    private func useLabel(_ use: DocumentUseRow) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(use.gone ? tr("documents_owner_gone") : use.title)
                .lineLimit(1)
            Text([use.kindLabel, use.roleLabel, use.label].filter { !$0.isEmpty }.joined(separator: " · "))
                .font(.footnote)
                .foregroundStyle(.secondary)
                .lineLimit(1)
        }
    }

    private func consumeOpened() {
        guard let opened = model.state.opened else { return }
        model.store.clearOpened()
        guard let url = CacheFiles.write(opened.file) else {
            notice = tr("m_cannot_open")
            return
        }
        if opened.share {
            sharedFile = SharedFile(url: url)
        } else {
            preview = url
        }
    }
}
