import SwiftUI

/// One entry of the menu of the costs tab: its text and where it leads.
struct CostsMoreEntry: Identifiable {
    let id: String
    let label: String
    let systemImage: String
    let action: () -> Void
}

/// The slot in the toolbar of the costs tab where budgets, recurring costs, the inbox and the receipts are added: a
/// feature that provides one adds its `CostsMoreEntry` to `costsMoreEntries`. With no entries the menu is not shown.
struct CostsMoreMenu: View {
    private var entries: [CostsMoreEntry] {
        costsMoreEntries()
    }

    var body: some View {
        if !entries.isEmpty {
            Menu {
                ForEach(entries) { entry in
                    Button(action: entry.action) {
                        Label(entry.label, systemImage: entry.systemImage)
                    }
                }
            } label: {
                Label(tr("m_costs_more_menu"), systemImage: "ellipsis.circle")
            }
        }
    }
}

private func costsMoreEntries() -> [CostsMoreEntry] {
    []
}
