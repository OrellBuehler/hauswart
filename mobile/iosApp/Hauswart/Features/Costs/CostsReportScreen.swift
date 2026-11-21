import shared
import SwiftUI

/// The year's costs of a book by month, category, device and tax class. `bookArg` is a book id or `all`; `year` 0
/// means this year.
struct CostsReportScreen: View {
    @StateObject private var model: Observed<CostsReportStore, CostsReportState>

    init(bookArg: String, year: Int) {
        let requested: String? = bookArg.isEmpty ? nil : bookArg
        _model = StateObject(
            wrappedValue: Observed(CostsReportStore(app: AppEnv.app, requestedBook: requested, requestedYear: Int32(year)))
        )
    }

    var body: some View {
        let state = model.state
        content(state)
            .navigationTitle(tr("costs_tab_report"))
            .navigationBarTitleDisplayMode(.inline)
    }

    @ViewBuilder
    private func content(_ state: CostsReportState) -> some View {
        if state.loading {
            LoadingView()
        } else if let error = state.error, state.cards.isEmpty, !state.empty {
            ErrorView(error: error) { model.store.refresh() }
        } else {
            list(state)
        }
    }

    private func list(_ state: CostsReportState) -> some View {
        List {
            if state.showSwitcher {
                Section {
                    BookChips(options: bookChoices(state.books), selected: state.bookId) { id in
                        model.store.selectBook(bookId: id)
                    }
                }
                .listRowInsets(EdgeInsets())
                .listRowBackground(Color.clear)
            }
            Section {
                HStack {
                    Button {
                        model.store.previousYear()
                    } label: {
                        Image(systemName: "chevron.left")
                    }
                    .buttonStyle(.borderless)
                    .accessibilityLabel(tr("costs_year_prev"))
                    Spacer()
                    Text(state.yearLabel + " · " + state.title)
                        .font(.headline)
                        .lineLimit(1)
                    Spacer()
                    Button {
                        model.store.nextYear()
                    } label: {
                        Image(systemName: "chevron.right")
                    }
                    .buttonStyle(.borderless)
                    .accessibilityLabel(tr("costs_year_next"))
                }
            }
            if state.empty {
                Section {
                    EmptyStateView(title: state.emptyText, message: "", systemImage: "chart.bar")
                }
            }
            ForEach(state.cards, id: \.id) { card in
                Section {
                    if card.rows.isEmpty {
                        Text(card.emptyText)
                            .font(.subheadline)
                            .foregroundStyle(.secondary)
                    }
                    ForEach(card.rows, id: \.key) { row in
                        ReportRowLine(row: row)
                    }
                    if let label = card.footerLabel, let value = card.footerValue {
                        LabeledContent(label, value: value)
                            .font(.footnote)
                    }
                } header: {
                    Text(card.title)
                }
            }
        }
        .refreshable { model.store.refresh() }
    }
}

/// A name, its amount, its share of the whole and a bar.
private struct ReportRowLine: View {
    let row: ReportRow

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack(alignment: .firstTextBaseline) {
                Text(row.label)
                    .lineLimit(2)
                Spacer(minLength: 12)
                Text(row.amount)
                    .monospacedDigit()
            }
            HStack(spacing: 8) {
                ProgressView(value: Double(row.fraction))
                    .tint(row.negative ? Color.green : Color.accentColor)
                Text(row.percent)
                    .font(.caption2)
                    .foregroundStyle(.secondary)
            }
        }
        .padding(.vertical, 2)
    }
}
