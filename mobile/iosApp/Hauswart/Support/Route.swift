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

    // Defects: the form for a new defect, optionally for an asset and a room
    case defectNew(String?, String?)
    // Documentation: the saved states of a page (by address)
    case docHistory(String)
    // Settings sub-screens
    case settingsNotifications
    case settingsReminders
    case settingsContactSync
    case settingsHousehold
    case settingsIntegrations
    case settingsIntegration(String)
    case settingsCalendar

    // Costs: balances and settlements of a book (`all` for every book, else the id of a book)
    case costsBalances(String)

    // Vehicles: the screens of a vehicle (the id is the asset id; `vehicleTireSet` takes the id of the set)
    case vehicleOdometer(String)
    case vehicleTires(String)
    case vehicleTireSet(String)
    case vehicleFuel(String)
    case vehicleStats(String)
    // Costs: budgets, recurring costs, the finance inbox, receipts (the status to list or `all`), books and tags
    case costsBudgets
    case costsRecurring
    case recurringDetail(String)
    case costsInbox
    case costsReceipts(String)
    case costBooks
    case costTags
    // Costs: the entries that wait for a review (every book and year), and the report of a book (`all` or an id) for a year (0 = this year)
    case costsReview
    case costsReport(String, Int)
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
    case .settingsNotifications: return AnyView(NotificationSettingsScreen())
    case .settingsReminders: return AnyView(ReminderSettingsScreen())
    case .settingsContactSync: return AnyView(PhoneContactsScreen())
    case .settingsHousehold: return AnyView(HouseholdSettingsScreen())
    case .settingsIntegrations: return AnyView(IntegrationsScreen())
    case let .settingsIntegration(kind): return AnyView(IntegrationScreen(kind: kind))
    case .settingsCalendar: return AnyView(CalendarTargetsScreen())

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
    case .docs: return AnyView(DocsScreen())
    case let .doc(slug): return AnyView(DocScreen(slug: slug))
    case let .docHistory(slug): return AnyView(DocRevisionsScreen(slug: slug))
    case .documents: return AnyView(DocumentsScreen())
    case .emergency: return AnyView(EmergencyScreen())

    // Defects and parts
    case .defects: return AnyView(DefectsScreen())
    case let .defect(id): return AnyView(DefectDetailScreen(id: id))
    case let .defectNew(assetId, roomId):
        return AnyView(DefectEditScreen(id: nil, assetId: assetId, roomId: roomId, embedded: true, onSaved: nil))
    case .parts: return AnyView(PartsScreen())
    case let .part(id): return AnyView(PartDetailScreen(id: id))

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
    case .costsReview: return AnyView(CostsScreen(reviewAll: true))
    case let .costsReport(book, year): return AnyView(CostsReportScreen(bookArg: book, year: year))

    // Insurance
    case .insurance: return AnyView(InsuranceScreen())
    case let .insurancePolicy(id): return AnyView(InsuranceDetailScreen(id: id))

    // Notifications and search
    case .notifications: return AnyView(NotificationsScreen())
    case .search: return AnyView(SearchScreen())

    // Vehicles
    case let .vehicleOdometer(id): return AnyView(OdometerScreen(assetId: id))
    case let .vehicleTires(id): return AnyView(TireSetsScreen(assetId: id))
    case let .vehicleTireSet(id): return AnyView(TireSetDetailScreen(id: id))
    case let .vehicleFuel(id): return AnyView(FuelLogScreen(assetId: id))
    case let .vehicleStats(id): return AnyView(VehicleStatsScreen(assetId: id))
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
