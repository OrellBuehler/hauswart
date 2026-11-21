import SwiftUI

/// Every destination that is pushed on a navigation stack. Link with
/// `NavigationLink(value: Route.contact(id)) { ... }`; `destination(for:)` maps a route to its
/// screen. A feature adds its cases to its own block here and in `destination(for:)`.
enum Route: Hashable {
    // Tabs
    case tasks
    case costs

    // Sections of "More"
    case appointments
    case inventory
    case rooms
    case plants
    case docs
    case documents
    case defects
    case parts
    case contacts
    case emergency
    case warranties
    case insurance
    case notifications
    case search
    case settings

    // Details other features link to
    case task(String)
    case appointment(String)
    case asset(String)
    case room(String)
    case doc(String)
    case defect(String)
    case part(String)
    case contact(String)
    case cost(String)
    case insurancePolicy(String)

    // Tasks: a new task, optionally for an asset
    case taskNew(String?)

    // Costs: balances and settlements of a book (`all` for every book, else the id of a book)
    case costsBalances(String)

    // Costs: budgets, recurring costs, the finance inbox, receipts (the status to list or `all`), books and tags
    case costsBudgets
    case costsRecurring
    case recurringDetail(String)
    case costsInbox
    case costsReceipts(String)
    case costBooks
    case costTags
}

/// Returns a type-erased view on purpose: a `switch` over this many cases inside a view builder
/// costs the compiler more time than it is given.
@MainActor
func destination(for route: Route) -> AnyView {
    switch route {
    // Contacts
    case .contacts: return AnyView(ContactsScreen())
    case let .contact(id): return AnyView(ContactDetailScreen(id: id))

    // Settings
    case .settings: return AnyView(SettingsScreen())

    // Tasks
    case .tasks: return AnyView(TasksScreen())
    case let .task(id): return AnyView(TaskDetailScreen(id: id))
    case let .taskNew(assetId): return AnyView(TaskEditScreen(id: nil, assetId: assetId))

    // Appointments
    case .appointments: return AnyView(AppointmentsScreen())
    case let .appointment(id): return AnyView(AppointmentDetailScreen(id: id))

    // Inventory, rooms, plants, warranties
    case .inventory: return AnyView(InventoryScreen())
    case let .asset(id): return AnyView(AssetDetailScreen(id: id))
    case .rooms: return AnyView(RoomsScreen())
    case let .room(id): return AnyView(RoomDetailScreen(id: id))
    case .plants: return AnyView(PlantsScreen())
    case .warranties: return AnyView(WarrantiesScreen())

    // Documentation and documents
    case .docs: return AnyView(ComingSoonScreen(title: tr("nav_docs")))
    case .doc: return AnyView(ComingSoonScreen(title: tr("nav_docs")))
    case .documents: return AnyView(ComingSoonScreen(title: tr("nav_documents")))
    case .emergency: return AnyView(ComingSoonScreen(title: tr("nav_emergency")))

    // Defects and parts
    case .defects: return AnyView(ComingSoonScreen(title: tr("nav_defects")))
    case .defect: return AnyView(ComingSoonScreen(title: tr("nav_defects")))
    case .parts: return AnyView(ComingSoonScreen(title: tr("nav_parts")))
    case .part: return AnyView(ComingSoonScreen(title: tr("nav_parts")))

    // Costs
    case .costs: return AnyView(CostsScreen())
    case let .cost(id): return AnyView(CostDetailScreen(id: id))
    case let .costsBalances(book): return AnyView(BalancesScreen(bookArg: book))
    case .costsBudgets: return AnyView(BudgetsScreen())
    case .costsRecurring: return AnyView(RecurringScreen())
    case let .recurringDetail(id): return AnyView(RecurringDetailScreen(id: id))
    case .costsInbox: return AnyView(InboxScreen())
    case let .costsReceipts(status): return AnyView(ReceiptsScreen(status: status))
    case .costBooks: return AnyView(CostBooksScreen())
    case .costTags: return AnyView(CostTagsScreen())

    // Insurance
    case .insurance: return AnyView(ComingSoonScreen(title: tr("nav_insurance")))
    case .insurancePolicy: return AnyView(ComingSoonScreen(title: tr("nav_insurance")))

    // Notifications and search
    case .notifications: return AnyView(NotificationsScreen())
    case .search: return AnyView(SearchScreen())
    }
}

/// A navigation stack whose pushed screens are `Route`s.
struct RouteStack<Root: View>: View {
    @ViewBuilder let root: () -> Root

    var body: some View {
        NavigationStack {
            root()
                .navigationDestination(for: Route.self) { route in
                    destination(for: route)
                }
        }
    }
}
