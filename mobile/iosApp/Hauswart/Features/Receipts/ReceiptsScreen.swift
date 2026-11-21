import QuickLook
import shared
import SwiftUI

/// The receipt the person is about to dismiss.
private struct DismissTarget: Identifiable {
    let id = UUID()
    var taskId: String
}

/// The receipt queue: open receipts first, the history 30 at a time. `status` is `pending`, `done`, `dismissed` or
/// `all`.
struct ReceiptsScreen: View {
    @StateObject private var model: Observed<ReceiptsStore, ReceiptsState>
    @State private var submitting = false
    @State private var dismissTarget: DismissTarget?
    @State private var deleteId: String?
    @State private var confirmingDelete = false
    @State private var preview: URL? = nil
    @State private var cannotOpen = false

    init(status: String) {
        _model = StateObject(wrappedValue: Observed(ReceiptsStore(app: AppEnv.app, initialStatus: status)))
    }

    var body: some View {
        let state = model.state
        content(state)
            .navigationTitle(tr("receipts_title"))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button {
                        submitting = true
                    } label: {
                        Label(tr("receipts_submit"), systemImage: "plus")
                    }
                }
            }
            .sheet(isPresented: $submitting) {
                ReceiptSubmitScreen()
            }
            .sheet(item: $dismissTarget) { item in
                DismissReasonSheet(taskId: item.taskId, store: model.store)
            }
            .quickLookPreview($preview)
            .confirmDelete(
                tr("receipts_delete_title"),
                message: deleteText(state),
                isPresented: $confirmingDelete
            ) {
                if let id = deleteId { model.store.delete(id: id) }
            }
            .onChange(of: state.opened != nil) { _, pending in
                if pending { consumeOpened() }
            }
    }

    private func deleteText(_ state: ReceiptsState) -> String {
        guard let id = deleteId, let row = state.rows.first(where: { $0.id == id }) else {
            return tr("receipts_delete_description")
        }
        return row.deleteText
    }

    private func consumeOpened() {
        guard let opened = model.state.opened else { return }
        model.store.clearOpened()
        guard let url = CacheFiles.write(opened.file) else {
            cannotOpen = true
            return
        }
        cannotOpen = false
        preview = url
    }

    @ViewBuilder
    private func content(_ state: ReceiptsState) -> some View {
        if state.loading {
            LoadingView()
        } else if let error = state.error, state.rows.isEmpty {
            ErrorView(error: error) { model.store.refresh() }
        } else {
            list(state)
        }
    }

    private func list(_ state: ReceiptsState) -> some View {
        List {
            if let notice = state.notice {
                Section {
                    CostsNoticeRow(message: notice) { model.store.dismissNotice() }
                }
            }
            if state.actionError != nil {
                Section {
                    ErrorBanner(error: state.actionError)
                }
            }
            if cannotOpen {
                Section {
                    Text(tr("m_cannot_open"))
                        .font(.footnote)
                        .foregroundStyle(.red)
                }
            }
            Section {
                Text(tr("receipts_explainer"))
                    .font(.footnote)
                    .foregroundStyle(.secondary)
                Picker(tr("receipts_filter_label"), selection: viewBinding) {
                    ForEach(state.views, id: \.value) { option in
                        Text(option.label + (option.badge.map { " (" + $0 + ")" } ?? "")).tag(option.value)
                    }
                }
                .pickerStyle(.segmented)
            }
            if state.rows.isEmpty {
                Section {
                    EmptyStateView(title: state.emptyTitle, message: state.emptyBody, systemImage: "doc.text.image")
                }
            } else {
                Section {
                    ForEach(state.rows, id: \.id) { row in
                        ReceiptLine(
                            row: row,
                            state: state,
                            store: model.store,
                            onDismiss: { dismissTarget = DismissTarget(taskId: row.id) },
                            onDelete: {
                                deleteId = row.id
                                confirmingDelete = true
                            }
                        )
                    }
                } header: {
                    Text(state.countText)
                }
                if state.hasMore {
                    Section {
                        if let error = state.moreError {
                            Text(error.message)
                                .font(.footnote)
                                .foregroundStyle(.red)
                        }
                        Button(state.loadingMore ? tr("common_loading") : tr("common_load_more")) {
                            model.store.loadMore()
                        }
                        .disabled(state.loadingMore)
                    }
                }
            }
        }
        .refreshable { model.store.refresh() }
    }

    private var viewBinding: Binding<String> {
        Binding(
            get: { model.state.view },
            set: { model.store.selectView(view: $0) }
        )
    }
}

private struct ReceiptLine: View {
    let row: ReceiptRowView
    let state: ReceiptsState
    let store: ReceiptsStore
    let onDismiss: () -> Void
    let onDelete: () -> Void

    var body: some View {
        let busy = state.busyId == row.id || state.opening == row.id
        VStack(alignment: .leading, spacing: 8) {
            HStack(alignment: .top, spacing: 12) {
                Button {
                    store.open(id: row.id)
                } label: {
                    ThumbImage(
                        version: state.thumbs,
                        placeholder: row.hasFile && !row.isImage ? "doc.richtext" : "doc",
                        width: 64,
                        height: 64,
                        request: { if row.hasThumb { store.requestThumbnail(id: row.id) } },
                        load: { row.hasThumb ? store.thumbnailBase64(id: row.id) : nil }
                    )
                }
                .buttonStyle(.plain)
                .disabled(!row.hasFile || busy)
                .accessibilityLabel(tr("receipts_open_file"))
                VStack(alignment: .leading, spacing: 4) {
                    HStack(spacing: 8) {
                        Badge(text: row.statusLabel, color: Tone.color(row.statusTone))
                        Text(row.createdText)
                            .font(.footnote)
                            .lineLimit(1)
                    }
                    Text(row.byText)
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                    if let note = row.note {
                        Text(note)
                            .font(.subheadline)
                    }
                    if let hints = row.hints {
                        Text(hints)
                            .font(.footnote)
                            .foregroundStyle(.secondary)
                    }
                    if let claim = row.claimText {
                        Text(claim)
                            .font(.footnote)
                            .foregroundStyle(.orange)
                    }
                    if !row.hasFile {
                        Text(tr("receipts_no_file"))
                            .font(.footnote)
                    }
                }
                Spacer(minLength: 0)
                if busy {
                    ProgressView()
                }
            }
            if row.hasFile, !row.isImage {
                Button(tr("receipts_open_pdf")) {
                    store.open(id: row.id)
                }
                .buttonStyle(.borderless)
                .disabled(busy)
            }
            if let title = row.resultTitle {
                VStack(alignment: .leading, spacing: 4) {
                    Text(title)
                        .font(.footnote.weight(.semibold))
                    ForEach(row.costs, id: \.id) { cost in
                        NavigationLink(value: Route.cost(cost.id)) {
                            HStack {
                                VStack(alignment: .leading, spacing: 2) {
                                    Text(cost.title)
                                        .lineLimit(2)
                                    HStack(spacing: 6) {
                                        Text(cost.date)
                                            .font(.footnote)
                                            .foregroundStyle(.secondary)
                                        if cost.reviewNeeded {
                                            Badge(text: tr("cost_badge_review"), color: .orange)
                                        }
                                    }
                                }
                                Spacer(minLength: 8)
                                Text(cost.amount)
                                    .lineLimit(1)
                            }
                        }
                    }
                    if let gone = row.resultGone {
                        Text(gone)
                            .font(.footnote)
                    }
                    if let note = row.resultNote {
                        Text(note)
                            .font(.footnote)
                    }
                }
            }
            if let closed = row.closedLine {
                Text(closed)
                    .font(.footnote)
                    .foregroundStyle(.secondary)
            }
            if let reason = row.dismissReason {
                Text(reason)
                    .font(.footnote)
            }
            if row.canDismiss || row.canDelete {
                HStack(spacing: 12) {
                    if row.canDismiss {
                        Button(tr("receipts_dismiss")) { onDismiss() }
                            .buttonStyle(.bordered)
                            .disabled(busy)
                    }
                    if row.canDelete {
                        Button(tr("common_delete"), role: .destructive) { onDelete() }
                            .buttonStyle(.borderless)
                            .disabled(busy)
                    }
                }
            }
        }
        .padding(.vertical, 4)
    }
}

/// Asks for the reason a receipt is dismissed (optional) and dismisses it.
private struct DismissReasonSheet: View {
    let taskId: String
    let store: ReceiptsStore
    @Environment(\.dismiss) private var dismiss
    @State private var reason = ""

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    TextEntry(label: tr("receipts_dismiss_reason"), text: $reason, multiline: true)
                } footer: {
                    Text(tr("receipts_dismiss_description") + " " + tr("receipts_dismiss_reason_hint"))
                }
            }
            .navigationTitle(tr("receipts_dismiss_title"))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button(tr("common_cancel")) { dismiss() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button(tr("receipts_dismiss")) {
                        let ok = store.dismiss(id: taskId, reason: reason)
                        if ok { dismiss() }
                    }
                }
            }
        }
    }
}
