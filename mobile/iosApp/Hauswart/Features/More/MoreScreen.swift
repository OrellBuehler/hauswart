import shared
import SwiftUI

/// Everything that is not a tab, grouped like the web sidebar.
struct MoreScreen: View {
    @StateObject private var model = Observed(MoreStore(app: AppEnv.app))

    var body: some View {
        let state = model.state
        List {
            Section {
                Label {
                    VStack(alignment: .leading, spacing: 2) {
                        Text(state.userName)
                        if state.username != state.userName {
                            Text(state.username)
                                .font(.footnote)
                                .foregroundStyle(.secondary)
                        }
                    }
                } icon: {
                    Image(systemName: "person.crop.circle")
                }
            }
            ForEach(state.groups, id: \.title) { group in
                Section(group.title) {
                    ForEach(group.items, id: \.id) { item in
                        if let target = MoreScreen.target(item.id) {
                            NavigationLink(value: target.route) {
                                Label(item.title, systemImage: target.systemImage)
                            }
                        }
                    }
                }
            }
            Section {
                NavigationLink(value: Route.settings) {
                    Label(tr("nav_settings"), systemImage: "gearshape")
                }
            }
        }
        .navigationTitle(tr("m_nav_more"))
    }

    private struct Target {
        let route: Route
        let systemImage: String
    }

    private static func target(_ id: String) -> Target? {
        switch id {
        case "appointments": return Target(route: .appointments, systemImage: "calendar.badge.clock")
        case "inventory": return Target(route: .inventory, systemImage: "shippingbox")
        case "rooms": return Target(route: .rooms, systemImage: "door.left.hand.open")
        case "plants": return Target(route: .plants, systemImage: "leaf")
        case "docs": return Target(route: .docs, systemImage: "book")
        case "documents": return Target(route: .documents, systemImage: "doc.on.doc")
        case "defects": return Target(route: .defects, systemImage: "wrench.and.screwdriver")
        case "parts": return Target(route: .parts, systemImage: "puzzlepiece")
        case "contacts": return Target(route: .contacts, systemImage: "person.crop.rectangle.stack")
        case "emergency": return Target(route: .emergency, systemImage: "light.beacon.max")
        case "warranties": return Target(route: .warranties, systemImage: "checkmark.shield")
        case "insurance": return Target(route: .insurance, systemImage: "umbrella")
        default: return nil
        }
    }
}
