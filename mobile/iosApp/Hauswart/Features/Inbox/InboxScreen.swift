import shared
import SwiftUI

/// The suggestions of the connected finance app that wait for a decision.
struct InboxScreen: View {
    @StateObject private var model = Observed(InboxStore(app: AppEnv.app))
    @State private var adjusting: AcceptTarget?
    @State private var dismissId: String?
    @State private var confirmingDismiss = false

    var body: some View {
        let state = model.state
        content(state)
            .navigationTitle(tr("finance_inbox_title"))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                if state.financeConnected {
                    ToolbarItem(placement: .topBarTrailing) {
                        if state.syncing {
                            ProgressView()
                        } else {
                            Button {
                                model.store.sync()
                            } label: {
                                Label(tr("finance_sync"), systemImage: "arrow.triangle.2.circlepath")
                            }
                        }
                    }
                }
            }
            .sheet(item: $adjusting) { item in
                SuggestionAcceptScreen(id: item.suggestionId)
            }
            .confirmationDialog(
                dismissId.map { model.store.dismissTitle(id: $0) } ?? "",
                isPresented: $confirmingDismiss,
                titleVisibility: .visible
            ) {
                Button(dismissId.map { model.store.dismissLabel(id: $0) } ?? "", role: .destructive) {
                    if let id = dismissId { model.store.dismiss(id: id) }
                }
                Button(tr("common_cancel"), role: .cancel) {}
            } message: {
                Text(dismissId.map { model.store.dismissText(id: $0) } ?? "")
            }
    }

    @ViewBuilder
    private func content(_ state: InboxState) -> some View {
        if state.loading {
            LoadingView()
        } else if let error = state.error, state.total == 0 {
            ErrorView(error: error) { model.store.refresh() }
        } else if !state.financeConnected, state.total == 0 {
            EmptyStateView(
                title: tr("finance_not_connected_title"),
                message: tr("finance_not_connected_body"),
                systemImage: "powerplug"
            )
        } else {
            list(state)
        }
    }

    private func list(_ state: InboxState) -> some View {
        List {
            if let notice = state.notice {
                Section {
                    if let kind = notice.targetKind, let id = notice.targetId {
                        InboxNoticeLink(message: notice.message, kind: kind, id: id)
                    } else {
                        CostsNoticeRow(message: notice.message) { model.store.dismissNotice() }
                    }
                }
            }
            if let text = state.syncError {
                Section {
                    CostsNoticeRow(message: text) { model.store.dismissSyncError() }
                }
            }
            if let text = state.actionError {
                Section {
                    CostsNoticeRow(message: text) { model.store.dismissActionError() }
                }
            }
            Section {
                Text(tr("finance_inbox_description"))
                    .font(.footnote)
                    .foregroundStyle(.secondary)
            }
            if state.total == 0 {
                Section {
                    EmptyStateView(
                        title: tr("finance_empty_title"),
                        message: tr("finance_empty_body"),
                        systemImage: "tray"
                    )
                    Button(tr("finance_sync")) { model.store.sync() }
                        .disabled(state.syncing)
                }
            } else {
                Section {
                    Text(state.countText)
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                }
                .listRowBackground(Color.clear)
            }
            ForEach(state.groups, id: \.kind) { group in
                Section {
                    ForEach(group.items, id: \.id) { suggestion in
                        SuggestionLine(
                            suggestion: suggestion,
                            busyAction: state.busyId == suggestion.id ? state.busyAction : nil,
                            locked: state.busyId != nil,
                            onAccept: { model.store.accept(id: suggestion.id) },
                            onAdjust: { adjusting = AcceptTarget(suggestionId: suggestion.id) },
                            onDismiss: {
                                dismissId = suggestion.id
                                confirmingDismiss = true
                            }
                        )
                    }
                } header: {
                    Text(group.title)
                } footer: {
                    if let hint = group.hint {
                        Text(hint)
                    }
                }
            }
        }
        .refreshable { model.store.refresh() }
    }
}

/// The adjust form is opened for one of these.
private struct AcceptTarget: Identifiable {
    let id = UUID()
    var suggestionId: String
}

/// The notice after an accept: it links to what was made.
private struct InboxNoticeLink: View {
    let message: String
    let kind: String
    let id: String

    var body: some View {
        if kind == "cost" {
            NavigationLink(value: Route.cost(id)) {
                Text(message)
                    .font(.footnote)
            }
        } else if kind == "asset" {
            NavigationLink(value: Route.asset(id)) {
                Text(message)
                    .font(.footnote)
            }
        } else {
            NavigationLink(value: Route.task(id)) {
                Text(message)
                    .font(.footnote)
            }
        }
    }
}

private struct SuggestionLine: View {
    let suggestion: SuggestionView
    let busyAction: String?
    let locked: Bool
    let onAccept: () -> Void
    let onAdjust: () -> Void
    let onDismiss: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(alignment: .top) {
                VStack(alignment: .leading, spacing: 2) {
                    Text(suggestion.title)
                        .lineLimit(3)
                    Text(suggestion.meta)
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                    if let note = suggestion.note {
                        Text(note)
                            .font(.footnote)
                    }
                }
                Spacer(minLength: 8)
                if let amount = suggestion.amount {
                    Text(amount)
                        .foregroundStyle(suggestion.refund ? Color.green : Color.primary)
                        .lineLimit(1)
                }
            }
            if let explain = suggestion.linkExplain {
                VStack(alignment: .leading, spacing: 2) {
                    Text(tr("finance_link_entry_heading"))
                        .font(.footnote.weight(.semibold))
                    if let entry = suggestion.linkedEntry {
                        NavigationLink(value: Route.cost(entry.id)) {
                            Text(entry.title)
                                .font(.subheadline)
                        }
                        Text(entry.meta)
                            .font(.footnote)
                            .foregroundStyle(.secondary)
                    }
                    Text(explain)
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                }
            }
            HStack(spacing: 12) {
                if !suggestion.linkGone {
                    Button(busyAction == "accept" ? tr("finance_accepting") : suggestion.acceptLabel) {
                        onAccept()
                    }
                    .buttonStyle(.borderedProminent)
                    .disabled(locked)
                }
                if suggestion.canAdjust {
                    Button(tr("finance_adjust")) {
                        onAdjust()
                    }
                    .buttonStyle(.bordered)
                    .disabled(locked)
                }
                Button(dismissLabel) {
                    onDismiss()
                }
                .buttonStyle(.borderless)
                .disabled(locked)
            }
            if let url = suggestion.url, let link = URL(string: url) {
                Link(tr("finance_open_in_app"), destination: link)
                    .font(.footnote)
            }
        }
        .padding(.vertical, 4)
    }

    private var dismissLabel: String {
        if busyAction == "dismiss" { return tr("finance_dismissing") }
        return suggestion.kind == "link" ? tr("finance_link_dismiss") : tr("finance_dismiss")
    }
}
