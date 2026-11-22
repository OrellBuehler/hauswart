import Contacts
import Foundation

/// A contact as the address book gets it. The shared module hands over `PhoneContact`s;
/// `PhoneContactRunner` turns them into these, so this file does not need the shared framework and
/// can work off the main thread.
struct PhoneContactItem {
    let contactId: String
    let phoneId: String?
    let changed: Bool
    let givenName: String
    let familyName: String
    let organization: String
    let phone: String
    let email: String
    let url: String
    let address: String
}

struct PhoneContactWork {
    let items: [PhoneContactItem]
    let remove: [String]
    let listId: String?
    let listName: String
    let removeList: Bool
    /// False when the system lets the app write contacts but not see the lists.
    let useList: Bool
}

struct PhoneContactOutcome {
    /// hauswart's contact id to the address book's id, for every item that is in the address book now.
    let written: [String: String]
    let listId: String?
}

enum PhoneContactAccess {
    case granted, limited, denied, undetermined
}

/// The only code that touches the phone's address book.
enum PhoneContacts {
    private static let queue = DispatchQueue(label: "ch.orellbuehler.hauswart.contacts")

    static func access() -> PhoneContactAccess {
        let status = CNContactStore.authorizationStatus(for: .contacts)
        if #available(iOS 18.0, *), status == .limited { return .limited }
        switch status {
        case .authorized: return .granted
        case .notDetermined: return .undetermined
        default: return .denied
        }
    }

    /// Shows the system's permission dialog; `done` is called on the main thread afterwards.
    static func requestAccess(done: @escaping () -> Void) {
        CNContactStore().requestAccess(for: .contacts) { _, error in
            if let error { NSLog("contacts permission failed: %@", error.localizedDescription) }
            DispatchQueue.main.async { done() }
        }
    }

    /// Writes `work` off the main thread; `done` gets the outcome on the main thread, nil when the
    /// address book refused.
    static func apply(_ work: PhoneContactWork, done: @escaping (PhoneContactOutcome?) -> Void) {
        queue.async {
            var outcome: PhoneContactOutcome?
            do {
                outcome = try write(work)
            } catch {
                let failure = error as NSError
                NSLog("phone contacts could not be written: %@ %ld", failure.domain, failure.code)
            }
            let result = outcome
            DispatchQueue.main.async { done(result) }
        }
    }

    private static let keys: [CNKeyDescriptor] = [
        CNContactIdentifierKey, CNContactTypeKey, CNContactGivenNameKey, CNContactFamilyNameKey,
        CNContactOrganizationNameKey, CNContactPhoneNumbersKey, CNContactEmailAddressesKey,
        CNContactUrlAddressesKey, CNContactPostalAddressesKey,
    ].map { $0 as CNKeyDescriptor }

    private static func write(_ work: PhoneContactWork) throws -> PhoneContactOutcome {
        let store = CNContactStore()
        let known = work.items.compactMap(\.phoneId) + work.remove
        let existing = known.isEmpty
            ? [:]
            : try contacts(store, matching: CNContact.predicateForContacts(withIdentifiers: known))

        var group: CNGroup?
        var members = Set<String>()
        if work.useList, !work.items.isEmpty {
            group = try list(store, work)
            if let group {
                members = try Set(contacts(
                    store, matching: CNContact.predicateForContactsInGroup(withIdentifier: group.identifier)
                ).keys)
            }
        }

        let request = CNSaveRequest()
        var written: [String: String] = [:]
        for item in work.items {
            if let phoneId = item.phoneId, let found = existing[phoneId] {
                if item.changed, let copy = found.mutableCopy() as? CNMutableContact {
                    fill(copy, item)
                    request.update(copy)
                }
                if let group, !members.contains(phoneId) { request.addMember(found, to: group) }
                written[item.contactId] = phoneId
            } else {
                // Never written, or the person deleted the entry on the phone: it is chosen, so it comes back.
                let fresh = CNMutableContact()
                fill(fresh, item)
                request.add(fresh, toContainerWithIdentifier: nil)
                if let group { request.addMember(fresh, to: group) }
                written[item.contactId] = fresh.identifier
            }
        }
        for phoneId in work.remove {
            if let copy = existing[phoneId]?.mutableCopy() as? CNMutableContact { request.delete(copy) }
        }
        if work.useList, work.removeList, let listId = work.listId,
           let old = try store.groups(matching: CNGroup.predicateForGroups(withIdentifiers: [listId])).first,
           let copy = old.mutableCopy() as? CNMutableGroup {
            request.delete(copy)
        }
        try store.execute(request)
        return PhoneContactOutcome(written: written, listId: group?.identifier)
    }

    /// Single entries, not the unified ones the Contacts app shows: an entry the person linked with
    /// another one keeps its own id this way.
    private static func contacts(_ store: CNContactStore, matching predicate: NSPredicate) throws -> [String: CNContact] {
        let fetch = CNContactFetchRequest(keysToFetch: keys)
        fetch.predicate = predicate
        fetch.unifyResults = false
        var found: [String: CNContact] = [:]
        try store.enumerateContacts(with: fetch) { contact, _ in
            found[contact.identifier] = contact
        }
        return found
    }

    /// The list made earlier, else one with the same name, else a new one. Nil when the account that
    /// gets new contacts has no lists (Exchange).
    private static func list(_ store: CNContactStore, _ work: PhoneContactWork) throws -> CNGroup? {
        let groups = try store.groups(matching: nil)
        if let listId = work.listId, let known = groups.first(where: { $0.identifier == listId }) { return known }
        let container = try store.containers(
            matching: CNContainer.predicateForContainers(withIdentifiers: [store.defaultContainerIdentifier()])
        ).first
        if container?.type == .exchange { return nil }
        if let container {
            let inContainer = try store.groups(matching: CNGroup.predicateForGroupsInContainer(withIdentifier: container.identifier))
            if let named = inContainer.first(where: { $0.name == work.listName }) { return named }
        }
        // Saved on its own before anything is added to it.
        let created = CNMutableGroup()
        created.name = work.listName
        let request = CNSaveRequest()
        request.add(created, toContainerWithIdentifier: nil)
        try store.execute(request)
        return created
    }

    private static func fill(_ contact: CNMutableContact, _ item: PhoneContactItem) {
        contact.contactType = item.givenName.isEmpty && item.familyName.isEmpty ? .organization : .person
        contact.givenName = item.givenName
        contact.familyName = item.familyName
        contact.organizationName = item.organization
        contact.phoneNumbers = item.phone.isEmpty
            ? []
            : [CNLabeledValue(label: CNLabelPhoneNumberMain, value: CNPhoneNumber(stringValue: item.phone))]
        contact.emailAddresses = item.email.isEmpty ? [] : [CNLabeledValue(label: CNLabelWork, value: item.email as NSString)]
        contact.urlAddresses = item.url.isEmpty
            ? []
            : [CNLabeledValue(label: CNLabelURLAddressHomePage, value: item.url as NSString)]
        if item.address.isEmpty {
            contact.postalAddresses = []
        } else {
            // hauswart keeps the address as free text; the address book shows it as written.
            let postal = CNMutablePostalAddress()
            postal.street = item.address
            contact.postalAddresses = [CNLabeledValue<CNPostalAddress>(label: CNLabelWork, value: postal)]
        }
    }
}
