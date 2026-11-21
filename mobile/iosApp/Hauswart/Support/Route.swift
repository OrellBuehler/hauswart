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
    case .tasks: return AnyView(ComingSoonScreen(title: tr("nav_tasks")))
    case .task: return AnyView(ComingSoonScreen(title: tr("nav_tasks")))

    // Appointments
    case .appointments: return AnyView(ComingSoonScreen(title: tr("nav_appointments")))
    case .appointment: return AnyView(ComingSoonScreen(title: tr("nav_appointments")))

    // Inventory, rooms, plants, warranties
    case .inventory: return AnyView(ComingSoonScreen(title: tr("nav_inventory")))
    case .asset: return AnyView(ComingSoonScreen(title: tr("nav_inventory")))
    case .rooms: return AnyView(ComingSoonScreen(title: tr("nav_rooms")))
    case .room: return AnyView(ComingSoonScreen(title: tr("nav_rooms")))
    case .plants: return AnyView(ComingSoonScreen(title: tr("nav_plants")))
    case .warranties: return AnyView(ComingSoonScreen(title: tr("nav_warranties")))

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
    case .costs: return AnyView(ComingSoonScreen(title: tr("nav_costs")))
    case .cost: return AnyView(ComingSoonScreen(title: tr("nav_costs")))

    // Insurance
    case .insurance: return AnyView(ComingSoonScreen(title: tr("nav_insurance")))
    case .insurancePolicy: return AnyView(ComingSoonScreen(title: tr("nav_insurance")))

    // Notifications and search
    case .notifications: return AnyView(ComingSoonScreen(title: tr("notifications_title")))
    case .search: return AnyView(ComingSoonScreen(title: tr("search_page_title")))
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
