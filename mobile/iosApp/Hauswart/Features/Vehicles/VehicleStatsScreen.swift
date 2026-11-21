import shared
import SwiftUI

/// The numbers of a vehicle per year: costs by category, distance, cost per distance, the next tasks.
struct VehicleStatsScreen: View {
    @StateObject private var model: Observed<VehicleStatsStore, VehicleStatsState>
    @State private var year = ""

    init(assetId: String) {
        _model = StateObject(wrappedValue: Observed(VehicleStatsStore(app: AppEnv.app, assetId: assetId)))
    }

    var body: some View {
        let state = model.state
        content(state)
            .navigationTitle(tr("m_vehicle_stats_title"))
            .navigationBarTitleDisplayMode(.inline)
            .onChange(of: state.year) { _, next in
                year = String(next)
            }
    }

    @ViewBuilder
    private func content(_ state: VehicleStatsState) -> some View {
        if state.loading {
            LoadingView()
        } else if let error = state.error {
            ErrorView(error: error) { model.store.refresh() }
        } else {
            ScrollView {
                VStack(spacing: 16) {
                    CardSection(title: "") {
                        ChoiceEntry(label: tr("vehicle_costs_year"), selection: yearBinding(state), options: vehicleChoices(state.years))
                        if state.yearError != nil {
                            ErrorBanner(error: state.yearError)
                            Button(tr("common_retry")) { model.store.refresh() }
                        }
                    }
                    if state.yearLoading {
                        ProgressView()
                    } else if state.empty {
                        EmptyStateView(title: state.emptyTitle, message: tr("vehicle_costs_empty_body"), systemImage: "chart.bar")
                    } else {
                        costs(state)
                        if !state.months.isEmpty {
                            CardSection(title: tr("m_vehicle_distance_by_month")) {
                                ForEach(state.months, id: \.label) { bar in
                                    VStack(alignment: .leading, spacing: 2) {
                                        HStack {
                                            Text(bar.label)
                                            Spacer()
                                            Text(bar.valueText)
                                        }
                                        .font(.footnote)
                                        VehicleBar(fraction: bar.fraction)
                                    }
                                }
                            }
                        }
                    }
                    if let tire = state.mountedTire {
                        Text(tire)
                            .font(.subheadline)
                            .frame(maxWidth: .infinity, alignment: .leading)
                    }
                    CardSection(title: tr("m_vehicle_next_tasks")) {
                        if state.tasks.isEmpty {
                            Text(tr("m_vehicle_next_tasks_none"))
                                .foregroundStyle(.secondary)
                        }
                        ForEach(state.tasks, id: \.id) { task in
                            LinkRow(route: Route.task(task.id)) {
                                VStack(alignment: .leading, spacing: 2) {
                                    Text(task.title)
                                    if let date = task.dateText {
                                        Text(date)
                                            .font(.footnote)
                                            .foregroundStyle(.secondary)
                                    }
                                }
                            }
                        }
                    }
                }
                .padding()
            }
            .background(Color(.systemGroupedBackground))
            .refreshable { model.store.refresh() }
        }
    }

    private func yearBinding(_ state: VehicleStatsState) -> Binding<String> {
        Binding(
            get: { year.isEmpty ? String(state.year) : year },
            set: { next in
                year = next
                if let value = Int32(next) {
                    model.store.selectYear(year: value)
                }
            }
        )
    }

    private func costs(_ state: VehicleStatsState) -> some View {
        CardSection(title: tr("vehicle_costs_title")) {
            Text(tr("vehicle_costs_total"))
                .font(.caption)
                .foregroundStyle(.secondary)
            Text(state.totalText)
                .font(.title.weight(.semibold))
            Text(state.countText)
                .font(.footnote)
                .foregroundStyle(.secondary)
            LabeledContent(tr("vehicle_costs_distance"), value: state.distanceText)
            LabeledContent(state.perDistanceLabel, value: state.perDistanceText ?? "–")
            ForEach(state.categories, id: \.label) { row in
                VStack(alignment: .leading, spacing: 2) {
                    HStack {
                        Text(row.label)
                            .lineLimit(1)
                        Spacer()
                        Text(row.amountText + " · " + row.percentText)
                    }
                    .font(.footnote)
                    VehicleBar(fraction: row.share)
                }
            }
            if let other = state.otherCurrencyText {
                Text(other)
                    .font(.footnote)
                    .foregroundStyle(.secondary)
            }
        }
    }
}
