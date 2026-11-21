import QuickLook
import shared
import SwiftUI

struct DocScreen: View {
    private let slug: String
    @StateObject private var model: Observed<DocViewStore, DocViewState>
    @Environment(\.dismiss) private var dismiss
    @Environment(\.openURL) private var openURL
    @Environment(\.colorScheme) private var colorScheme
    @State private var extras = false
    @State private var editing = false
    @State private var creating = false
    @State private var confirmingDelete = false
    @State private var pushed: Route? = nil
    @State private var preview: URL? = nil
    @State private var notice: String? = nil

    init(slug: String) {
        self.slug = slug
        _model = StateObject(wrappedValue: Observed(DocViewStore(app: AppEnv.app, slug: slug)))
    }

    var body: some View {
        let state = model.state
        content(state)
            .navigationTitle(state.title.isEmpty ? tr("nav_docs") : state.title)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                if !state.pageId.isEmpty {
                    ToolbarItem(placement: .topBarTrailing) {
                        menu(state)
                    }
                }
            }
            .sheet(isPresented: $editing) {
                DocEditScreen(slug: slug, section: "", assetId: "", roomId: "", title: "") { _ in }
            }
            .quickLookPreview($preview)
            .navigationDestination(item: $pushed) { route in
                destination(for: route)
            }
            .confirmDelete(
                tr("docs_delete_title"),
                message: tr("docs_delete_description", ["title": state.title]),
                isPresented: $confirmingDelete
            ) {
                model.store.delete()
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
            .onChange(of: state.deleted) { _, deleted in
                if deleted { dismiss() }
            }
            .onChange(of: state.opened != nil) { _, ready in
                if ready { consumeOpened() }
            }
    }

    @ViewBuilder
    private func content(_ state: DocViewState) -> some View {
        if state.missing {
            VStack(spacing: 16) {
                EmptyStateView(
                    title: tr("docs_missing_title"),
                    message: tr("docs_missing_body", ["slug": slug]),
                    systemImage: "questionmark.folder"
                )
                Button(tr("docs_missing_create")) { creating = true }
                    .buttonStyle(.borderedProminent)
            }
            .sheet(isPresented: $creating) {
                DocEditScreen(slug: nil, section: "", assetId: "", roomId: "", title: state.suggestedTitle) { _ in }
            }
        } else if !state.pageId.isEmpty {
            VStack(spacing: 0) {
                Picker("", selection: $extras) {
                    Text(tr("m_docs_tab_page")).tag(false)
                    Text(tr("m_docs_tab_extras")).tag(true)
                }
                .pickerStyle(.segmented)
                .padding(.horizontal)
                .padding(.vertical, 8)
                if extras {
                    List {
                        AttachmentsSection(ownerType: "page", ownerId: state.pageId)
                        DocumentLinksSection(ownerType: "page", ownerId: state.pageId)
                        CommentsSection(ownerType: "doc_page", ownerId: state.pageId)
                    }
                } else {
                    DocWebView(bodyHtml: state.bodyHtml, dark: colorScheme == .dark) { url in
                        handle(url)
                    }
                }
            }
        } else if let error = state.error {
            ErrorView(error: error) { model.store.refresh() }
        } else {
            LoadingView()
        }
    }

    private func menu(_ state: DocViewState) -> some View {
        Menu {
            Button {
                editing = true
            } label: {
                Label(tr("common_edit"), systemImage: "pencil")
            }
            Button {
                pushed = .docHistory(slug)
            } label: {
                Label(tr("docs_history"), systemImage: "clock.arrow.circlepath")
            }
            Button {
                model.store.togglePin()
            } label: {
                Label(tr(state.pinned ? "docs_unpin" : "docs_pin"), systemImage: state.pinned ? "pin.slash" : "pin")
            }
            Button {
                model.store.toggleArchive()
            } label: {
                Label(tr(state.archived ? "docs_unarchive" : "docs_archive"), systemImage: "archivebox")
            }
            Button(role: .destructive) {
                confirmingDelete = true
            } label: {
                Label(tr("common_delete"), systemImage: "trash")
            }
        } label: {
            Label(tr("docs_actions"), systemImage: "ellipsis.circle")
        }
    }

    private func handle(_ url: String) -> Bool {
        let target = model.store.linkTarget(url: url)
        return handleDocLink(
            target,
            openURL: openURL,
            push: { pushed = $0 },
            attachment: { model.store.openAttachment(id: $0) },
            cannotOpen: { notice = tr("m_cannot_open") }
        )
    }

    private func consumeOpened() {
        guard let opened = model.state.opened else { return }
        model.store.clearOpened()
        if let url = CacheFiles.write(opened.file) {
            preview = url
        } else {
            notice = tr("m_cannot_open")
        }
    }
}
