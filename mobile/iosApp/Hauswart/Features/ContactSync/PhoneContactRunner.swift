import shared
import SwiftUI

/// What the system allows, as one of the shared module's `PHONE_ACCESS_` values. Screens watch it
/// and tell their store.
@MainActor
final class PhoneContactStatus: ObservableObject {
    static let shared = PhoneContactStatus()
    @Published private(set) var access = PhoneContactStatus.current()

    func refresh() {
        let now = PhoneContactStatus.current()
        if now != access { access = now }
    }

    private static func current() -> String {
        switch PhoneContacts.access() {
        case .granted: PhoneContactsStoreKt.PHONE_ACCESS_GRANTED
        case .limited: PhoneContactsStoreKt.PHONE_ACCESS_LIMITED
        case .denied: PhoneContactsStoreKt.PHONE_ACCESS_DENIED
        case .undetermined: PhoneContactsStoreKt.PHONE_ACCESS_UNDETERMINED
        }
    }
}

/// Writes the chosen contacts into the phone's address book: when the app comes to the foreground,
/// after contacts or the choice changed, and with the background refresh of the reminders.
@MainActor
enum PhoneContactRunner {
    private static let sync = PhoneContactSync(app: AppEnv.app)
    private static var watching: StoreSubscription?
    private static var busy = false
    private static var again = false

    /// Syncs now. `mayAsk` is false in the background, where the permission dialog cannot be shown.
    static func syncNow(mayAsk: Bool = true, done: @escaping () -> Void = {}) {
        guard !busy else {
            again = true
            done()
            return
        }
        busy = true
        sync.run { plan in
            handle(plan, mayAsk: mayAsk) {
                finished()
                done()
            }
        }
    }

    /// Syncs again whenever contacts or the choice change while the app runs. Call once.
    static func start() {
        guard watching == nil else { return }
        watching = sync.watch { plan in
            guard !busy else {
                again = true
                return
            }
            busy = true
            handle(plan, mayAsk: true) { finished() }
        }
    }

    /// One write at a time: a plan made while another is being written would create its entries twice.
    private static func finished() {
        busy = false
        if again {
            again = false
            syncNow()
        }
    }

    private static func handle(_ plan: PhoneContactPlan?, mayAsk: Bool, done: @escaping () -> Void) {
        PhoneContactStatus.shared.refresh()
        guard let plan, !plan.nothingToDo else {
            done()
            return
        }
        switch PhoneContacts.access() {
        case .granted:
            write(plan, useList: true, done: done)
        case .limited:
            write(plan, useList: false, done: done)
        case .undetermined where mayAsk && !plan.contacts.isEmpty:
            PhoneContacts.requestAccess {
                PhoneContactStatus.shared.refresh()
                switch PhoneContacts.access() {
                case .granted: write(plan, useList: true, done: done)
                case .limited: write(plan, useList: false, done: done)
                default: done()
                }
            }
        default:
            done()
        }
    }

    private static func write(_ plan: PhoneContactPlan, useList: Bool, done: @escaping () -> Void) {
        let work = PhoneContactWork(
            items: plan.contacts.map { contact in
                PhoneContactItem(
                    contactId: contact.contactId,
                    phoneId: contact.phoneId,
                    changed: contact.changed,
                    givenName: contact.givenName,
                    familyName: contact.familyName,
                    organization: contact.organization,
                    phone: contact.phone,
                    email: contact.email,
                    url: contact.url,
                    address: contact.address
                )
            },
            remove: plan.remove,
            listId: plan.listId,
            listName: plan.listName,
            removeList: plan.removeList,
            useList: useList
        )
        PhoneContacts.apply(work) { outcome in
            if let outcome {
                sync.applied(plan: plan, written: outcome.written, listId: outcome.listId)
            } else {
                sync.failed()
            }
            done()
        }
    }
}
