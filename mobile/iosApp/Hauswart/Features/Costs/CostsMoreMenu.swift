import shared
import SwiftUI

/// The menu in the toolbar of the costs tab: budgets, recurring costs, the finance inbox (only while a finance app is
/// connected), the receipts, the cost books and the tags.
struct CostsMoreMenu: View {
    @StateObject private var model = Observed(CostsMenuStore(app: AppEnv.app))
    private let bookArg: String
    private let year: Int

    init(bookArg: String, year: Int) {
        self.bookArg = bookArg
        self.year = year
    }

    var body: some View {
        let entries = model.state.entries
        if !entries.isEmpty {
            Menu {
                ForEach(entries, id: \.key) { entry in
                    NavigationLink(value: route(for: entry.key)) {
                        Label(entry.label + (entry.badge.map { " (" + $0 + ")" } ?? ""), systemImage: symbol(for: entry.key))
                    }
                }
            } label: {
                Label(tr("m_costs_more_menu"), systemImage: "ellipsis.circle")
            }
        }
    }

    private func route(for key: String) -> Route {
        switch key {
        case CostsMenuStoreKt.MENU_REPORT: return .costsReport(bookArg, year)
        case CostsMenuStoreKt.MENU_BUDGETS: return .costsBudgets
        case CostsMenuStoreKt.MENU_RECURRING: return .costsRecurring
        case CostsMenuStoreKt.MENU_INBOX: return .costsInbox
        case CostsMenuStoreKt.MENU_RECEIPTS: return .costsReceipts("all")
        case CostsMenuStoreKt.MENU_BOOKS: return .costBooks
        default: return .costTags
        }
    }

    private func symbol(for key: String) -> String {
        switch key {
        case CostsMenuStoreKt.MENU_REPORT: return "chart.bar"
        case CostsMenuStoreKt.MENU_BUDGETS: return "gauge.with.dots.needle.50percent"
        case CostsMenuStoreKt.MENU_RECURRING: return "repeat"
        case CostsMenuStoreKt.MENU_INBOX: return "tray"
        case CostsMenuStoreKt.MENU_RECEIPTS: return "doc.text.image"
        case CostsMenuStoreKt.MENU_BOOKS: return "books.vertical"
        default: return "tag"
        }
    }
}
