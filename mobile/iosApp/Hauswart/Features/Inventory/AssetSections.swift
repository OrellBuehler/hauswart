import shared
import SwiftUI

// The sections of an asset are cards in a ScrollView (see CardSection). A sheet or dialog is attached
// to the card itself, which is not lazy, and gets the section's state as a parameter: it must not
// create a second `Observed` around the store, because that would close the store when it goes away.

// MARK: - Care hints

private struct HintSheet: Identifiable {
    let id = UUID()
    let hint: HintItem?
}

struct AssetHintsSection: View {
    private let assetId: String
    @StateObject private var model: Observed<AssetHintsStore, HintsState>
    @State private var sheet: HintSheet?
    @State private var deleting: HintItem?
    @State private var confirmingDelete = false

    init(assetId: String) {
        self.assetId = assetId
        _model = StateObject(wrappedValue: Observed(AssetHintsStore(app: AppEnv.app, assetId: assetId)))
    }

    var body: some View {
        let state = model.state
        CardSection(title: tr("asset_hints_title")) {
            if state.notice != nil {
                NoticeBanner(notice: state.notice, dismiss: { model.store.dismissNotice() })
            }
            if state.actionError != nil {
                ErrorBanner(error: state.actionError)
            }
            if state.error != nil {
                ErrorBanner(error: state.error)
            }
            if !state.loading && state.items.isEmpty && state.error == nil {
                Text(tr("hints_empty_title"))
                    .foregroundStyle(.secondary)
            }
            ForEach(state.items, id: \.id) { hint in
                HintRowView(
                    hint: hint,
                    assetId: assetId,
                    busy: state.busy,
                    onTogglePin: { model.store.togglePin(hintId: hint.id) },
                    onEdit: {
                        model.store.clearForm()
                        sheet = HintSheet(hint: hint)
                    },
                    onToggleGuest: { model.store.toggleGuest(hintId: hint.id) },
                    onMove: { delta in model.store.move(hintId: hint.id, delta: delta) },
                    onDelete: {
                        deleting = hint
                        confirmingDelete = true
                    }
                )
                Divider()
            }
            Button {
                model.store.clearForm()
                sheet = HintSheet(hint: nil)
            } label: {
                Label(tr("hint_add"), systemImage: "plus")
            }
        }
        .sheet(item: $sheet) { open in
            HintFormSheet(store: model.store, state: model.state, hint: open.hint)
        }
        .confirmDelete(
            tr("hint_delete_title"),
            message: tr("hint_delete_description", ["title": deleting?.title ?? ""]),
            isPresented: $confirmingDelete
        ) {
            if let hint = deleting { model.store.delete(hintId: hint.id) }
        }
        .onChange(of: state.saved) { _, saved in
            if saved {
                sheet = nil
                model.store.ackSaved()
            }
        }
    }
}

private struct HintRowView: View {
    let hint: HintItem
    let assetId: String
    let busy: Bool
    let onTogglePin: () -> Void
    let onEdit: () -> Void
    let onToggleGuest: () -> Void
    let onMove: (Int32) -> Void
    let onDelete: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack {
                Label(hint.kindLabel, systemImage: hintKindSymbol(hint.kind))
                    .font(.caption)
                    .foregroundStyle(.secondary)
                Spacer()
                Button {
                    onTogglePin()
                } label: {
                    Image(systemName: hint.pinned ? "pin.fill" : "pin")
                        .frame(minWidth: 44, minHeight: 44)
                }
                .disabled(busy)
                Menu {
                    Button {
                        onEdit()
                    } label: {
                        Label(tr("common_edit"), systemImage: "pencil")
                    }
                    Button {
                        onToggleGuest()
                    } label: {
                        Label(tr("hint_guest_visible"), systemImage: hint.guestVisible ? "checkmark" : "eye")
                    }
                    Button {
                        onMove(-1)
                    } label: {
                        Label(tr("hint_move_up"), systemImage: "arrow.up")
                    }
                    .disabled(!hint.canMoveUp)
                    Button {
                        onMove(1)
                    } label: {
                        Label(tr("hint_move_down"), systemImage: "arrow.down")
                    }
                    .disabled(!hint.canMoveDown)
                    Button(role: .destructive) {
                        onDelete()
                    } label: {
                        Label(tr("common_delete"), systemImage: "trash")
                    }
                } label: {
                    Image(systemName: "ellipsis.circle")
                        .frame(minWidth: 44, minHeight: 44)
                }
                .disabled(busy)
            }
            Text(hint.title)
                .font(.subheadline.weight(.semibold))
            if !hint.body.isEmpty {
                Text(hint.body)
                    .font(.subheadline)
            }
            if hint.guestVisible {
                Badge(text: tr("hint_guest_badge"))
            }
            if let reaction = hint.reactionNote {
                Text(reaction)
                    .font(.footnote)
                    .foregroundStyle(.secondary)
            }
            if let taskId = hint.taskId, let taskTitle = hint.taskTitle {
                LinkRow(route: Route.task(taskId)) {
                    Text(tr("hint_task_linked", ["title": taskTitle]))
                        .font(.footnote)
                        .lineLimit(1)
                }
            } else {
                LinkRow(route: Route.taskNew(assetId)) {
                    Text(tr("hint_plan_task"))
                        .font(.footnote)
                        .lineLimit(1)
                }
            }
        }
    }
}

private struct HintFormSheet: View {
    let store: AssetHintsStore
    let state: HintsState
    let hint: HintItem?
    @State private var kind = "tip"
    @State private var title = ""
    @State private var bodyText = ""
    @State private var pinned = false
    @State private var guestVisible = false
    @State private var filled = false

    var body: some View {
        SheetForm(
            title: hint == nil ? tr("hint_create_title") : tr("hint_edit_title"),
            saving: state.saving,
            onSave: {
                store.save(
                    hintId: hint?.id,
                    form: HintForm(kind: kind, title: title, body: bodyText, pinned: pinned, guestVisible: guestVisible)
                )
            }
        ) {
            Section {
                ChoiceEntry(label: tr("hint_kind"), selection: $kind, options: kinds)
                TextEntry(label: tr("hint_title"), text: $title, error: state.fieldErrors["title"])
                TextEntry(label: tr("hint_body"), text: $bodyText, error: state.fieldErrors["bodyMd"], multiline: true)
            }
            Section {
                ToggleEntry(label: tr("hint_pinned"), isOn: $pinned, hint: tr("hint_pinned_hint"))
                ToggleEntry(label: tr("hint_guest_visible"), isOn: $guestVisible, hint: tr("hint_guest_visible_hint"))
            }
            if hint?.reactionNote != nil {
                Section {
                    Text(tr("m_hint_reaction_edit_web"))
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                }
            }
            if state.formError != nil {
                Section {
                    ErrorBanner(error: state.formError)
                }
            }
        }
        .onAppear { fill() }
    }

    private var kinds: [Choice] {
        AssetSectionsKt.HINT_KINDS.map { Choice(value: $0, label: AssetSectionsKt.hintKindLabel(kind: $0)) }
    }

    private func fill() {
        guard !filled, let hint else { return }
        kind = hint.form.kind
        title = hint.form.title
        bodyText = hint.form.body
        pinned = hint.form.pinned
        guestVisible = hint.form.guestVisible
        filled = true
    }
}

// MARK: - Asset notes

private struct NoteSheet: Identifiable {
    let id = UUID()
    let note: NoteItem
}

struct AssetNotesSection: View {
    @StateObject private var model: Observed<AssetNotesStore, NotesState>
    @State private var draft = ""
    @State private var sheet: NoteSheet?
    @State private var deleting: NoteItem?
    @State private var confirmingDelete = false
    @State private var converting: NoteItem?
    @State private var confirmingConvert = false

    init(assetId: String) {
        _model = StateObject(wrappedValue: Observed(AssetNotesStore(app: AppEnv.app, assetId: assetId)))
    }

    var body: some View {
        let state = model.state
        CardSection(title: tr("asset_notes_title")) {
            Text(tr("asset_notes_description"))
                .font(.footnote)
                .foregroundStyle(.secondary)
            if state.notice != nil {
                NoticeBanner(notice: state.notice, undo: { model.store.undo() }, dismiss: { model.store.dismissNotice() })
            }
            if state.actionError != nil {
                ErrorBanner(error: state.actionError)
            }
            if state.error != nil {
                ErrorBanner(error: state.error)
            }
            TextEntry(label: tr("asset_notes_add_label"), text: $draft, multiline: true)
            if sheet == nil && state.formError != nil {
                ErrorBanner(error: state.formError)
            }
            Button {
                model.store.clearForm()
                model.store.save(noteId: nil, text: draft)
            } label: {
                Label(state.saving ? tr("asset_notes_adding") : tr("common_add"), systemImage: "plus")
            }
            .buttonStyle(.bordered)
            .disabled(state.saving)
            if !state.loading && state.open.isEmpty && state.error == nil {
                Text(tr("asset_notes_empty_title"))
                    .foregroundStyle(.secondary)
            }
            ForEach(state.open, id: \.id) { note in
                noteRow(note, busy: state.busyId == note.id)
                Divider()
            }
            if !state.shareText.isEmpty {
                ShareLink(item: state.shareText, subject: Text(state.shareTitle)) {
                    Label(tr("m_asset_share_notes"), systemImage: "square.and.arrow.up")
                }
            }
            Button {
                model.store.toggleResolved()
            } label: {
                Label(
                    state.resolvedShown ? tr("asset_notes_hide_resolved") : tr("asset_notes_show_resolved"),
                    systemImage: state.resolvedShown ? "chevron.up" : "chevron.down"
                )
            }
            if state.resolvedShown {
                if state.resolvedError != nil {
                    ErrorBanner(error: state.resolvedError)
                }
                if state.resolved.isEmpty && !state.resolvedLoading && state.resolvedError == nil {
                    Text(tr("asset_notes_resolved_empty"))
                        .foregroundStyle(.secondary)
                }
                ForEach(state.resolved, id: \.id) { note in
                    noteRow(note, busy: state.busyId == note.id)
                    Divider()
                }
                if state.resolvedHasMore {
                    Button(tr("common_load_more")) { model.store.loadMoreResolved() }
                        .disabled(state.resolvedLoading)
                }
            }
        }
        .sheet(item: $sheet) { open in
            NoteEditSheet(store: model.store, state: model.state, note: open.note)
        }
        .confirmDelete(
            tr("asset_notes_delete_title"),
            message: tr("asset_notes_delete_description", ["text": deleting?.excerpt ?? ""]),
            isPresented: $confirmingDelete
        ) {
            if let note = deleting { model.store.delete(noteId: note.id) }
        }
        .confirmationDialog(
            tr("asset_notes_to_defect_title"),
            isPresented: $confirmingConvert,
            titleVisibility: .visible
        ) {
            Button(tr("asset_notes_to_defect_confirm")) {
                if let note = converting { model.store.toDefect(noteId: note.id) }
            }
            Button(tr("common_cancel"), role: .cancel) {}
        } message: {
            Text(tr("asset_notes_to_defect_description", ["text": converting?.excerpt ?? ""]))
        }
        .onChange(of: state.saved) { _, saved in
            if saved {
                if sheet == nil { draft = "" }
                sheet = nil
                model.store.ackSaved()
            }
        }
    }

    private func noteRow(_ note: NoteItem, busy: Bool) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack(alignment: .top) {
                Text(note.body)
                    .font(.subheadline)
                    .foregroundStyle(note.resolved ? Color.secondary : Color.primary)
                Spacer()
                Menu {
                    Button {
                        model.store.clearForm()
                        sheet = NoteSheet(note: note)
                    } label: {
                        Label(tr("common_edit"), systemImage: "pencil")
                    }
                    if note.resolved {
                        Button {
                            model.store.reopen(noteId: note.id)
                        } label: {
                            Label(tr("asset_notes_reopen"), systemImage: "arrow.uturn.backward")
                        }
                    } else {
                        Button {
                            converting = note
                            confirmingConvert = true
                        } label: {
                            Label(tr("asset_notes_to_defect"), systemImage: "wrench.and.screwdriver")
                        }
                    }
                    Button(role: .destructive) {
                        deleting = note
                        confirmingDelete = true
                    } label: {
                        Label(tr("common_delete"), systemImage: "trash")
                    }
                } label: {
                    Image(systemName: "ellipsis.circle")
                        .frame(minWidth: 44, minHeight: 44)
                }
                .disabled(busy)
            }
            Text(note.meta + (note.doneText.map { " · " + $0 } ?? ""))
                .font(.footnote)
                .foregroundStyle(.secondary)
            if note.resolved {
                if let defectId = note.defectId {
                    LinkRow(route: Route.defect(defectId)) {
                        Text(tr("asset_notes_via_defect"))
                            .font(.footnote)
                    }
                } else if note.viaService {
                    Text(tr("asset_notes_via_service"))
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                }
            } else {
                Button {
                    model.store.resolve(noteId: note.id)
                } label: {
                    Label(tr("asset_notes_resolve"), systemImage: "checkmark")
                }
                .buttonStyle(.bordered)
                .disabled(busy)
            }
        }
    }
}

private struct NoteEditSheet: View {
    let store: AssetNotesStore
    let state: NotesState
    let note: NoteItem
    @State private var text = ""
    @State private var filled = false

    var body: some View {
        SheetForm(
            title: tr("asset_notes_edit_title"),
            saving: state.saving,
            onSave: { store.save(noteId: note.id, text: text) }
        ) {
            Section {
                TextEntry(label: tr("asset_notes_add_label"), text: $text, multiline: true)
            }
            if state.formError != nil {
                Section {
                    ErrorBanner(error: state.formError)
                }
            }
        }
        .onAppear {
            if !filled {
                text = note.body
                filled = true
            }
        }
    }
}

// MARK: - Service log

private struct ServiceSheet: Identifiable {
    let id = UUID()
    let entry: ServiceItem?
}

struct AssetServiceLogSection: View {
    @StateObject private var model: Observed<AssetServiceLogStore, ServiceLogState>
    @State private var sheet: ServiceSheet?
    @State private var deleting: ServiceItem?
    @State private var confirmingDelete = false

    init(assetId: String) {
        _model = StateObject(wrappedValue: Observed(AssetServiceLogStore(app: AppEnv.app, assetId: assetId)))
    }

    var body: some View {
        let state = model.state
        CardSection(title: tr("asset_service_title")) {
            if state.notice != nil {
                NoticeBanner(notice: state.notice, dismiss: { model.store.dismissNotice() })
            }
            if state.actionError != nil {
                ErrorBanner(error: state.actionError)
            }
            if state.error != nil {
                ErrorBanner(error: state.error)
            }
            if !state.loading && state.items.isEmpty && state.error == nil {
                Text(tr("service_empty_title"))
                    .foregroundStyle(.secondary)
            }
            ForEach(state.items, id: \.id) { entry in
                serviceRow(entry)
                Divider()
            }
            if state.hasMore {
                Button(tr("common_load_more")) { model.store.loadMore() }
                    .disabled(state.loadingMore)
            }
            Button {
                model.store.clearForm()
                sheet = ServiceSheet(entry: nil)
            } label: {
                Label(tr("service_add"), systemImage: "plus")
            }
        }
        .sheet(item: $sheet) { open in
            ServiceFormSheet(store: model.store, state: model.state, entry: open.entry)
        }
        .confirmDelete(
            tr("service_delete_title"),
            message: tr("service_delete_description", ["title": deleting?.title ?? ""]),
            isPresented: $confirmingDelete
        ) {
            if let entry = deleting { model.store.delete(entryId: entry.id) }
        }
        .onChange(of: state.saved) { _, saved in
            if saved {
                sheet = nil
                model.store.ackSaved()
            }
        }
    }

    private func serviceRow(_ entry: ServiceItem) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack(alignment: .top) {
                VStack(alignment: .leading, spacing: 2) {
                    Text(entry.title)
                        .font(.subheadline.weight(.semibold))
                    Text(entry.kindLabel + " · " + entry.dateText)
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                }
                Spacer()
                Menu {
                    Button {
                        model.store.clearForm()
                        sheet = ServiceSheet(entry: entry)
                    } label: {
                        Label(tr("common_edit"), systemImage: "pencil")
                    }
                    Button(role: .destructive) {
                        deleting = entry
                        confirmingDelete = true
                    } label: {
                        Label(tr("common_delete"), systemImage: "trash")
                    }
                } label: {
                    Image(systemName: "ellipsis.circle")
                        .frame(minWidth: 44, minHeight: 44)
                }
            }
            if !entry.details.isEmpty {
                Text(entry.details)
                    .font(.footnote)
            }
            if let contactId = entry.contactId, let contactName = entry.contactName {
                LinkRow(route: Route.contact(contactId)) {
                    Text(contactName)
                        .font(.footnote)
                }
            }
            if let cost = entry.costText {
                Text(cost)
                    .font(.footnote.weight(.medium))
            }
        }
    }
}

private struct ServiceFormSheet: View {
    let store: AssetServiceLogStore
    let state: ServiceLogState
    let entry: ServiceItem?
    @State private var kind = "maintenance"
    @State private var date = ""
    @State private var title = ""
    @State private var details = ""
    @State private var contactId = ""
    @State private var cost = ""
    @State private var resolvedNoteIds: [String] = []
    @State private var filled = false

    var body: some View {
        SheetForm(
            title: entry == nil ? tr("service_create_title") : tr("service_edit_title"),
            saving: state.saving,
            onSave: {
                store.save(
                    entryId: entry?.id,
                    form: ServiceForm(
                        kind: kind,
                        date: date,
                        title: title,
                        details: details,
                        contactId: contactId,
                        cost: cost,
                        resolvedNoteIds: resolvedNoteIds
                    )
                )
            }
        ) {
            Section {
                ChoiceEntry(label: tr("service_kind"), selection: $kind, options: choices(state.kindOptions))
                DateEntry(label: tr("service_date"), value: $date, error: state.fieldErrors["date"], clearable: false)
                TextEntry(label: tr("service_title"), text: $title, error: state.fieldErrors["title"])
                TextEntry(label: tr("service_description"), text: $details, error: state.fieldErrors["descriptionMd"], multiline: true)
                ChoiceEntry(label: tr("service_contact"), selection: $contactId, options: choices(state.contactOptions))
                MoneyEntry(
                    label: tr("service_cost", ["currency": state.currency]),
                    text: $cost,
                    currency: state.currency,
                    error: state.fieldErrors["costMinor"]
                )
            }
            if !state.openNotes.isEmpty {
                Section(tr("asset_notes_picker_title")) {
                    ForEach(state.openNotes, id: \.id) { note in
                        Toggle(note.excerpt, isOn: noteBinding(note.id))
                    }
                }
            }
            if state.formError != nil {
                Section {
                    ErrorBanner(error: state.formError)
                }
            }
        }
        .onAppear { fill() }
    }

    private func noteBinding(_ id: String) -> Binding<Bool> {
        Binding(
            get: { resolvedNoteIds.contains(id) },
            set: { on in
                if on {
                    if !resolvedNoteIds.contains(id) { resolvedNoteIds.append(id) }
                } else {
                    resolvedNoteIds.removeAll { $0 == id }
                }
            }
        )
    }

    private func fill() {
        guard !filled else { return }
        let initial: ServiceForm = entry?.form ?? state.blank
        kind = initial.kind
        date = initial.date
        title = initial.title
        details = initial.details
        contactId = initial.contactId
        cost = initial.cost
        resolvedNoteIds = initial.resolvedNoteIds
        filled = true
    }
}

// MARK: - Contacts

private struct ContactLinkSheet: Identifiable {
    let id = UUID()
}

struct AssetContactsSection: View {
    @StateObject private var model: Observed<AssetContactsStore, ContactLinksState>
    @State private var sheet: ContactLinkSheet?

    init(assetId: String) {
        _model = StateObject(wrappedValue: Observed(AssetContactsStore(app: AppEnv.app, assetId: assetId)))
    }

    var body: some View {
        let state = model.state
        CardSection(title: tr("asset_contacts_title")) {
            if state.notice != nil {
                NoticeBanner(notice: state.notice, undo: { model.store.undo() }, dismiss: { model.store.dismissNotice() })
            }
            if state.actionError != nil {
                ErrorBanner(error: state.actionError)
            }
            if state.error != nil {
                ErrorBanner(error: state.error)
            }
            if !state.loading && state.items.isEmpty && state.error == nil {
                Text(tr("asset_contacts_empty_title"))
                    .foregroundStyle(.secondary)
            }
            ForEach(state.items, id: \.linkId) { link in
                HStack {
                    LinkRow(route: Route.contact(link.contactId)) {
                        VStack(alignment: .leading, spacing: 2) {
                            Text(link.name)
                                .lineLimit(1)
                            Text(link.roleLabel + (link.company.map { " · " + $0 } ?? ""))
                                .font(.footnote)
                                .foregroundStyle(.secondary)
                                .lineLimit(1)
                        }
                    }
                    Button {
                        model.store.unlink(linkId: link.linkId)
                    } label: {
                        Image(systemName: "xmark.circle")
                            .frame(minWidth: 44, minHeight: 44)
                    }
                    .disabled(state.busy)
                    .accessibilityLabel(tr("contact_unlink_aria", ["name": link.name]))
                }
                Divider()
            }
            Button {
                model.store.clearForm()
                sheet = ContactLinkSheet()
            } label: {
                Label(tr("contact_link_add"), systemImage: "plus")
            }
        }
        .sheet(item: $sheet) { _ in
            ContactLinkFormSheet(store: model.store, state: model.state)
        }
        .onChange(of: state.saved) { _, saved in
            if saved {
                sheet = nil
                model.store.ackSaved()
            }
        }
    }
}

private struct ContactLinkFormSheet: View {
    let store: AssetContactsStore
    let state: ContactLinksState
    @State private var contactId = ""
    @State private var role = "service"

    var body: some View {
        SheetForm(
            title: tr("contact_link_title"),
            saveLabel: tr("contact_link_submit"),
            saving: state.saving,
            onSave: { store.link(contactId: contactId, role: role) }
        ) {
            Section {
                Picker(tr("contact_link_list"), selection: $contactId) {
                    Text(tr("m_none")).tag("")
                    ForEach(state.contactOptions, id: \.value) { option in
                        Text(option.label).tag(option.value)
                    }
                }
                ChoiceEntry(label: tr("contact_link_role"), selection: $role, options: choices(state.roleOptions))
            }
            if state.formError != nil {
                Section {
                    ErrorBanner(error: state.formError)
                }
            }
        }
    }
}

// MARK: - Spare parts

private struct PartLinkSheet: Identifiable {
    let id = UUID()
}

struct AssetPartsSection: View {
    @StateObject private var model: Observed<AssetPartsStore, PartLinksState>
    @State private var sheet: PartLinkSheet?

    init(assetId: String) {
        _model = StateObject(wrappedValue: Observed(AssetPartsStore(app: AppEnv.app, assetId: assetId)))
    }

    var body: some View {
        let state = model.state
        CardSection(title: tr("asset_parts_title")) {
            if state.notice != nil {
                NoticeBanner(notice: state.notice, undo: { model.store.undo() }, dismiss: { model.store.dismissNotice() })
            }
            if state.actionError != nil {
                ErrorBanner(error: state.actionError)
            }
            if state.error != nil {
                ErrorBanner(error: state.error)
            }
            if !state.loading && state.items.isEmpty && state.error == nil {
                Text(tr("asset_parts_empty_title"))
                    .foregroundStyle(.secondary)
            }
            ForEach(state.items, id: \.partId) { part in
                HStack {
                    LinkRow(route: Route.part(part.partId)) {
                        VStack(alignment: .leading, spacing: 2) {
                            Text(part.name)
                                .lineLimit(1)
                            Badge(text: part.stockText, color: Tone.color(part.stockTone))
                            if let price = part.priceText {
                                Text(price)
                                    .font(.footnote)
                                    .foregroundStyle(.secondary)
                            }
                        }
                    }
                    Button {
                        model.store.unlink(partId: part.partId)
                    } label: {
                        Image(systemName: "xmark.circle")
                            .frame(minWidth: 44, minHeight: 44)
                    }
                    .disabled(state.busy)
                    .accessibilityLabel(tr("part_unlink_aria", ["name": part.name]))
                }
                Divider()
            }
            Button {
                model.store.clearForm()
                sheet = PartLinkSheet()
            } label: {
                Label(tr("part_link_add"), systemImage: "plus")
            }
        }
        .sheet(item: $sheet) { _ in
            PartLinkFormSheet(store: model.store, state: model.state)
        }
        .onChange(of: state.saved) { _, saved in
            if saved {
                sheet = nil
                model.store.ackSaved()
            }
        }
    }
}

private struct PartLinkFormSheet: View {
    let store: AssetPartsStore
    let state: PartLinksState
    @State private var partId = ""

    var body: some View {
        SheetForm(
            title: tr("part_link_title"),
            saveLabel: tr("part_link_submit"),
            saving: state.saving,
            onSave: { store.link(partId: partId) }
        ) {
            Section {
                if state.partOptions.isEmpty {
                    Text(tr("part_link_empty"))
                        .foregroundStyle(.secondary)
                } else {
                    Picker(tr("part_link_list"), selection: $partId) {
                        Text(tr("m_none")).tag("")
                        ForEach(state.partOptions, id: \.value) { option in
                            Text(option.label).tag(option.value)
                        }
                    }
                }
            }
            if state.formError != nil {
                Section {
                    ErrorBanner(error: state.formError)
                }
            }
        }
    }
}
