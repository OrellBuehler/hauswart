import shared
import SwiftUI

struct InsuranceScreen: View {
    @StateObject private var model = Observed(InsuranceListStore(app: AppEnv.app))
    @State private var query = ""
    @State private var creating = false
    @State private var opened: Route? = nil

    var body: some View {
        let state = model.state
        content(state)
            .navigationTitle(tr("nav_insurance"))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button {
                        creating = true
                    } label: {
                        Label(tr("insurance_new"), systemImage: "plus")
                    }
                }
            }
            .sheet(isPresented: $creating) {
                InsuranceEditScreen(id: nil, assetId: "", type: "") { id in
                    opened = .insurancePolicy(id)
                }
            }
            .navigationDestination(item: $opened) { route in
                destination(for: route)
            }
    }

    @ViewBuilder
    private func content(_ state: InsuranceListState) -> some View {
        if state.loading {
            LoadingView()
        } else if let error = state.error, !state.hasAny {
            ErrorView(error: error) { model.store.refresh() }
        } else if !state.hasAny {
            EmptyStateView(title: tr("insurance_empty_title"), message: tr("insurance_empty_body"), systemImage: "umbrella")
        } else {
            list(state)
                .searchable(text: $query, prompt: tr("insurance_search_placeholder"))
                .onChange(of: query) { _, value in
                    model.store.search(query: value)
                }
        }
    }

    private func list(_ state: InsuranceListState) -> some View {
        List {
            Section {
                Picker(tr("insurance_type_label"), selection: typeBinding) {
                    Text(tr("insurance_filter_type_all")).tag("")
                    ForEach(InsuranceLogicKt.INSURANCE_TYPES, id: \.self) { type in
                        Text(InsuranceLogicKt.insuranceTypeLabel(type: type)).tag(type)
                    }
                }
                if state.hasArchived {
                    Toggle(tr("insurance_show_archived"), isOn: archivedBinding)
                }
                if state.filtered {
                    Button(tr("insurance_filter_reset")) {
                        query = ""
                        model.store.resetFilters()
                    }
                }
                Text([tr("insurance_count", ["count": state.rows.count]), state.total].filter { !$0.isEmpty }.joined(separator: " · "))
                    .font(.footnote)
                    .foregroundStyle(.secondary)
                if !state.otherCurrency.isEmpty {
                    Text(state.otherCurrency)
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                }
            }
            if state.rows.isEmpty {
                if state.filtered {
                    EmptyStateView(
                        title: tr("insurance_empty_filtered_title"),
                        message: tr("insurance_empty_filtered_body"),
                        systemImage: "magnifyingglass"
                    )
                } else if state.archived {
                    EmptyStateView(
                        title: tr("insurance_empty_archived_title"),
                        message: tr("insurance_empty_archived_body"),
                        systemImage: "umbrella"
                    )
                } else {
                    EmptyStateView(title: tr("insurance_empty_title"), message: tr("insurance_empty_body"), systemImage: "umbrella")
                }
            }
            Section {
                ForEach(state.rows, id: \.id) { row in
                    NavigationLink(value: Route.insurancePolicy(row.id)) {
                        PolicyRowView(row: row)
                    }
                }
            }
        }
        .refreshable { model.store.refresh() }
    }

    private var typeBinding: Binding<String> {
        Binding(
            get: { model.state.type },
            set: { model.store.setType(type: $0) }
        )
    }

    private var archivedBinding: Binding<Bool> {
        Binding(
            get: { model.state.archived },
            set: { model.store.setArchived(value: $0) }
        )
    }
}

private struct PolicyRowView: View {
    let row: PolicyRowItem

    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            VStack(alignment: .leading, spacing: 2) {
                HStack(spacing: 6) {
                    Text(row.title)
                        .lineLimit(1)
                    if row.archived {
                        Badge(text: tr("insurance_archived"))
                    }
                }
                Text(row.subtitle)
                    .font(.footnote)
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
                if !row.covers.isEmpty {
                    Text(row.covers)
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                        .lineLimit(1)
                }
                if let deadline = row.deadline {
                    Text(deadline.text)
                        .font(.caption)
                        .foregroundStyle(Tone.color(deadline.tone))
                        .lineLimit(2)
                }
            }
            Spacer(minLength: 0)
            VStack(alignment: .trailing, spacing: 2) {
                Text(row.annual)
                    .font(.subheadline.weight(.medium))
                    .lineLimit(1)
                Text(tr("insurance_per_annual"))
                    .font(.caption2)
                    .foregroundStyle(.secondary)
            }
        }
    }
}
