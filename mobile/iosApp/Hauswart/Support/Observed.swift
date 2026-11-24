import Combine
import shared

/// Keeps a store of the shared module alive for a screen and publishes its state.
///
///     @StateObject private var model = Observed(ContactsListStore(app: AppEnv.app))
///     ...
///     model.state.groups        // render
///     model.store.refresh()     // act
///
/// With arguments the store is created in `init`, still inside the autoclosure so it is made once:
///
///     @StateObject private var model: Observed<ContactDetailStore, ContactDetailState>
///     init(id: String) {
///         _model = StateObject(wrappedValue: Observed(ContactDetailStore(app: AppEnv.app, id: id)))
///     }
@MainActor
final class Observed<St: Store<S>, S: AnyObject>: ObservableObject {
    let store: St
    @Published private(set) var state: S
    private var subscription: StoreSubscription?

    init(_ store: St) {
        self.store = store
        state = (store.value as S?)!
        subscription = store.subscribe { [weak self] in
            guard let self, let next = self.store.value as S? else { return }
            self.state = next
        }
    }

    deinit {
        subscription?.cancel()
        store.close()
    }
}
