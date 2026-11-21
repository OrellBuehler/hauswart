import shared
import SwiftUI

struct NotificationsScreen: View {
    @StateObject private var model = Observed(NotificationsStore(app: AppEnv.app))

    var body: some View {
        let state = model.state
        content(state)
            .navigationTitle(tr("notifications_title"))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button {
                        model.store.markAllRead()
                    } label: {
                        Label(tr("notifications_mark_all"), systemImage: "checkmark.circle")
                    }
                    .disabled(state.unreadCount == 0 || state.markingAll)
                }
            }
    }

    private func content(_ state: NotificationsState) -> some View {
        List {
            Section {
                Picker(tr("notifications_filter"), selection: filterBinding) {
                    Text(tr("notifications_filter_all")).tag(false)
                    Text(tr("notifications_filter_unread")).tag(true)
                }
                .pickerStyle(.segmented)
            }
            if state.loading {
                LoadingView()
                    .frame(height: 120)
            } else if let error = state.error, state.rows.isEmpty {
                ErrorView(error: error) { model.store.refresh() }
            } else if state.rows.isEmpty {
                EmptyStateView(
                    title: state.onlyUnread ? tr("notifications_empty_unread_title") : tr("notifications_empty_title"),
                    message: state.onlyUnread ? tr("notifications_empty_unread_body") : tr("notifications_empty_body"),
                    systemImage: "bell"
                )
            } else {
                Section {
                    ForEach(state.rows, id: \.id) { row in
                        rowView(row)
                    }
                    if state.hasMore {
                        Button(tr("common_load_more")) { model.store.loadMore() }
                            .buttonStyle(.borderless)
                            .disabled(state.loadingMore)
                    }
                }
                if state.actionError != nil {
                    Section {
                        ErrorBanner(error: state.actionError)
                    }
                }
            }
        }
        .refreshable { model.store.refresh() }
    }

    @ViewBuilder
    private func rowView(_ row: NotificationRow) -> some View {
        if let link = row.link, let route = Route.from(link: link) {
            NavigationLink(value: route) {
                NotificationItemView(row: row)
            }
            .simultaneousGesture(TapGesture().onEnded { model.store.markRead(id: row.id) })
        } else {
            Button {
                model.store.markRead(id: row.id)
            } label: {
                NotificationItemView(row: row)
            }
            .buttonStyle(.plain)
        }
    }

    private var filterBinding: Binding<Bool> {
        Binding(
            get: { model.state.onlyUnread },
            set: { model.store.setOnlyUnread(value: $0) }
        )
    }
}

private struct NotificationItemView: View {
    let row: NotificationRow

    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            Image(systemName: symbol)
                .foregroundStyle(tint)
                .frame(width: 24)
            VStack(alignment: .leading, spacing: 2) {
                Text(row.text)
                    .font(.subheadline.weight(row.unread ? .semibold : .regular))
                    .lineLimit(4)
                Text(row.whenText)
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
            Spacer(minLength: 0)
            if row.unread {
                Circle()
                    .fill(Color.accentColor)
                    .frame(width: 10, height: 10)
                    .padding(.top, 6)
                    .accessibilityLabel(tr("notifications_unread"))
            }
        }
    }

    private var symbol: String {
        switch row.kind {
        case "prep": "shippingbox"
        case "due_soon": "alarm"
        case "due": "bell.badge"
        case "overdue": "exclamationmark.triangle"
        case "digest": "list.bullet"
        case "comment": "bubble.left"
        case "hint": "lightbulb"
        default: "info.circle"
        }
    }

    private var tint: Color {
        switch row.kind {
        case "overdue": .red
        case "due", "due_soon", "hint": .orange
        default: .secondary
        }
    }
}
