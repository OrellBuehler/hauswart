import shared
import SwiftUI

struct WarrantiesScreen: View {
    @StateObject private var model = Observed(WarrantiesStore(app: AppEnv.app))

    var body: some View {
        let state = model.state
        content(state)
            .navigationTitle(tr("warranties_title"))
            .navigationBarTitleDisplayMode(.inline)
    }

    @ViewBuilder
    private func content(_ state: WarrantiesState) -> some View {
        if state.loading {
            LoadingView()
        } else if let error = state.error, state.total == 0 {
            ErrorView(error: error) { model.store.refresh() }
        } else if state.total == 0 {
            EmptyStateView(title: tr("warranties_empty_title"), message: tr("warranties_empty_body"), systemImage: "checkmark.shield")
        } else {
            List {
                Section {
                    Picker(tr("warranties_filter_label"), selection: statusBinding) {
                        ForEach(state.chips, id: \.value) { chip in
                            Text(chip.label + " " + String(chip.count)).tag(chip.value)
                        }
                    }
                }
                if state.rows.isEmpty {
                    EmptyStateView(
                        title: tr("warranties_filter_empty_title"),
                        message: tr("warranties_filter_empty_body"),
                        systemImage: "checkmark.shield"
                    )
                }
                Section {
                    ForEach(state.rows, id: \.assetId) { row in
                        NavigationLink(value: Route.asset(row.assetId)) {
                            VStack(alignment: .leading, spacing: 2) {
                                Text(row.name)
                                    .lineLimit(1)
                                if !row.subtitle.isEmpty {
                                    Text(row.subtitle)
                                        .font(.footnote)
                                        .foregroundStyle(.secondary)
                                        .lineLimit(1)
                                }
                                Badge(text: row.info.label, color: Tone.color(row.info.tone))
                                if let daysText = row.info.daysText {
                                    Text(daysText)
                                        .font(.footnote)
                                        .foregroundStyle(.secondary)
                                }
                                if let extended = row.extendedText {
                                    Text(extended)
                                        .font(.footnote)
                                        .foregroundStyle(.secondary)
                                }
                            }
                        }
                    }
                }
            }
            .refreshable { model.store.refresh() }
        }
    }

    private var statusBinding: Binding<String> {
        Binding(
            get: { model.state.status },
            set: { model.store.select(status: $0) }
        )
    }
}
