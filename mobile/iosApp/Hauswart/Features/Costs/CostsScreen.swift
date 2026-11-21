import shared
import SwiftUI

/// The costs tab: the entries of the book on screen, the year's totals and where the person stands.
struct CostsScreen: View {
    @StateObject private var model = Observed(CostsListStore(app: AppEnv.app))
    @State private var query = ""
    @State private var quick = false
    @State private var creating = false

    var body: some View {
        let state = model.state
        let bookArg = CostsSupportKt.bookArgOf(bookId: state.bookId)
        content(state)
            .navigationTitle(tr("nav_costs"))
            .navigationBarTitleDisplayMode(.inline)
            .searchable(text: $query, prompt: tr("costs_search_placeholder"))
            .onChange(of: query) { _, value in
                model.store.search(query: value)
            }
            .toolbar {
                ToolbarItemGroup(placement: .topBarTrailing) {
                    NavigationLink(value: Route.costsBalances(bookArg)) {
                        Label(tr("balances_open"), systemImage: "scalemass")
                    }
                    Button {
                        creating = true
                    } label: {
                        Label(tr("cost_new"), systemImage: "plus")
                    }
                    CostsMoreMenu()
                }
            }
            .overlay(alignment: .bottomTrailing) {
                Button {
                    quick = true
                } label: {
                    Image(systemName: "bolt.fill")
                        .font(.title2)
                        .foregroundStyle(.white)
                        .frame(width: 56, height: 56)
                        .background(Color.accentColor, in: Circle())
                        .shadow(radius: 3, y: 2)
                }
                .accessibilityLabel(tr("quick_fab"))
                .padding(16)
            }
            .sheet(isPresented: $quick) {
                QuickEntryScreen(bookArg: bookArg)
            }
            .sheet(isPresented: $creating) {
                CostEditScreen(id: nil, bookArg: bookArg, assetId: nil)
            }
    }

    @ViewBuilder
    private func content(_ state: CostsListState) -> some View {
        if state.loading {
            LoadingView()
        } else if let error = state.error, state.summary == nil {
            ErrorView(error: error) { model.store.refresh() }
        } else {
            list(state)
        }
    }

    private func list(_ state: CostsListState) -> some View {
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
                yearRow(state)
            }
            if let summary = state.summary {
                Section {
                    NavigationLink(value: Route.costsBalances(CostsSupportKt.bookArgOf(bookId: state.bookId))) {
                        SummaryBlock(summary: summary, balance: state.balance, unavailable: state.balancesUnavailable)
                    }
                }
            }
            Section {
                if state.reviewCount > 0 || state.reviewOnly {
                    Toggle(state.reviewLabel, isOn: reviewBinding)
                }
                Picker(tr("costs_filter_category"), selection: categoryBinding) {
                    Text(tr("costs_filter_all")).tag("")
                    ForEach(state.categories, id: \.value) { option in
                        Text(option.label).tag(option.value)
                    }
                }
                Picker(tr("costs_filter_paid_by"), selection: payerBinding) {
                    Text(tr("costs_filter_all")).tag("")
                    ForEach(state.payers, id: \.value) { option in
                        Text(option.label).tag(option.value)
                    }
                }
                if state.filtered {
                    Button(tr("tasks_filter_reset")) {
                        query = ""
                        model.store.resetFilters()
                    }
                }
            }
            if state.total == 0 {
                Section {
                    EmptyStateView(
                        title: tr("costs_empty_title", ["year": state.yearLabel]),
                        message: tr("costs_empty_body"),
                        systemImage: "banknote"
                    )
                }
            } else if state.shown == 0 {
                Section {
                    EmptyStateView(
                        title: tr("costs_empty_filtered_title"),
                        message: tr("costs_empty_filtered_body"),
                        systemImage: "magnifyingglass"
                    )
                }
            } else {
                Section {
                    Text(state.countText)
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                }
                .listRowBackground(Color.clear)
            }
            ForEach(state.groups, id: \.key) { group in
                Section {
                    ForEach(group.rows, id: \.id) { row in
                        NavigationLink(value: Route.cost(row.id)) {
                            CostRowLine(row: row)
                        }
                    }
                } header: {
                    HStack {
                        Text(group.title)
                        Spacer()
                        Text(group.total)
                    }
                }
            }
        }
        .refreshable { model.store.refresh() }
    }

    private func yearRow(_ state: CostsListState) -> some View {
        HStack {
            Button {
                model.store.previousYear()
            } label: {
                Image(systemName: "chevron.left")
            }
            .buttonStyle(.borderless)
            .accessibilityLabel(tr("costs_year_prev"))
            Spacer()
            Text(state.yearLabel)
                .font(.headline)
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

    private var reviewBinding: Binding<Bool> {
        Binding(
            get: { model.state.reviewOnly },
            set: { model.store.setReviewOnly(value: $0) }
        )
    }

    private var categoryBinding: Binding<String> {
        Binding(
            get: { model.state.category },
            set: { model.store.setCategory(category: $0) }
        )
    }

    private var payerBinding: Binding<String> {
        Binding(
            get: { model.state.paidBy },
            set: { model.store.setPaidBy(userId: $0) }
        )
    }
}

/// The year's total and, below it, where the person stands.
private struct SummaryBlock: View {
    let summary: CostSummaryView
    let balance: CostBalanceView?
    let unavailable: Bool

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(summary.title)
                .font(.footnote)
                .foregroundStyle(.secondary)
            Text(summary.total)
                .font(.title2.weight(.semibold))
            Text(summary.count)
                .font(.footnote)
                .foregroundStyle(.secondary)
            if let equity = summary.equity {
                Text(tr("costs_equity_label") + ": " + equity)
                    .font(.footnote)
            }
            if let other = summary.otherCurrency {
                Text(other)
                    .font(.footnote)
                    .foregroundStyle(.secondary)
            }
            Divider()
            Text(tr("balances_teaser_title"))
                .font(.footnote)
                .foregroundStyle(.secondary)
            if unavailable {
                Text(tr("balances_unavailable"))
                    .font(.subheadline)
            } else if let balance {
                if let you = balance.you {
                    ToneLabel(text: you.text, tone: you.tone, font: .headline)
                }
                ForEach(balance.payments, id: \.self) { payment in
                    Text(payment)
                        .font(.subheadline)
                }
                if !balance.status.isEmpty {
                    Text(balance.status)
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                }
            }
            Text(tr("balances_open"))
                .font(.footnote.weight(.semibold))
                .foregroundStyle(Color.accentColor)
        }
        .padding(.vertical, 4)
    }
}
