import shared
import SwiftUI

extension Route {
    /// The screen an `AppLink` (from a notification or a search hit) opens; nil for a link the app
    /// has no screen for (the home screen is the root of the first tab and needs none).
    ///
    /// The kinds are the `LINK_*` constants of `AppLink.kt`.
    static func from(link: AppLink) -> Route? {
        let id = link.id ?? ""
        switch link.kind {
        case "tasks": return .tasks
        case "task": return .task(id)
        case "appointments": return .appointments
        case "appointment": return .appointment(id)
        case "inventory": return .inventory
        case "asset": return .asset(id)
        case "rooms": return .rooms
        case "room": return .room(id)
        case "plants": return .plants
        case "docs": return .docs
        case "doc": return .doc(id)
        case "documents": return .documents
        case "defects": return .defects
        case "defect": return .defect(id)
        case "parts": return .parts
        case "part": return .part(id)
        case "contacts": return .contacts
        case "contact": return .contact(id)
        case "emergency": return .emergency
        case "warranties": return .warranties
        case "insurance": return .insurance
        case "policy": return .insurancePolicy(id)
        case "costs": return .costs
        case "cost": return .cost(id)
        case "notifications": return .notifications
        case "search": return .search
        case "settings": return .settings
        default: return nil
        }
    }
}
