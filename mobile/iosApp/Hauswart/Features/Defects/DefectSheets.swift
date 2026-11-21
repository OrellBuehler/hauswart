import shared
import SwiftUI

/// Moves a defect to `target`. Presented as a sheet.
struct DefectStatusSheet: View {
    @StateObject private var model: Observed<DefectStatusStore, DefectStatusState>
    @Environment(\.dismiss) private var dismiss
    @State private var loaded = false
    @State private var date = ""
    @State private var text = ""

    init(id: String, target: String) {
        _model = StateObject(wrappedValue: Observed(DefectStatusStore(app: AppEnv.app, id: id, target: target)))
    }

    var body: some View {
        let state = model.state
        SheetForm(
            title: state.title.isEmpty ? tr("nav_defects") : state.title,
            saveLabel: state.submitLabel.isEmpty ? nil : state.submitLabel,
            saving: state.saving || !loaded,
            onSave: { model.store.save(form: DefectStatusForm(date: date, text: text)) }
        ) {
            content(state)
        }
        .onAppear { fill(state.initial) }
        .onChange(of: state.initial) { _, initial in
            fill(initial)
        }
        .onChange(of: state.done) { _, done in
            if done { dismiss() }
        }
    }

    @ViewBuilder
    private func content(_ state: DefectStatusState) -> some View {
        if let error = state.loadError {
            Section {
                ErrorBanner(error: error)
                Button(tr("common_retry")) { model.store.retry() }
            }
        } else if !loaded {
            Section {
                ProgressView()
            }
        } else {
            Section {
                Text(state.intro)
                    .font(.footnote)
                    .foregroundStyle(.secondary)
                if state.needsDate {
                    DateEntry(
                        label: state.dateLabel,
                        value: $date,
                        error: state.fieldErrors["date"],
                        clearable: false
                    )
                }
                TextEntry(
                    label: state.textLabel,
                    text: $text,
                    error: state.fieldErrors["note"] ?? state.fieldErrors["resolutionMd"],
                    multiline: true
                )
            }
            if state.error != nil {
                Section {
                    ErrorBanner(error: state.error)
                }
            }
        }
    }

    private func fill(_ initial: DefectStatusForm?) {
        guard !loaded, let initial else { return }
        date = initial.date
        text = initial.text
        loaded = true
    }
}

/// Notes a letter sent or received. Presented as a sheet.
struct DefectCorrespondenceSheet: View {
    @StateObject private var model: Observed<DefectCorrespondenceStore, DefectCorrespondenceState>
    @Environment(\.dismiss) private var dismiss
    @State private var body_ = ""
    @State private var reference = ""

    init(id: String) {
        _model = StateObject(wrappedValue: Observed(DefectCorrespondenceStore(app: AppEnv.app, id: id)))
    }

    var body: some View {
        let state = model.state
        SheetForm(
            title: tr("defect_correspondence_title"),
            saveLabel: tr("defect_correspondence_submit"),
            saving: state.saving,
            onSave: { model.store.save(form: DefectCorrespondenceForm(body: body_, reference: reference)) }
        ) {
            Section {
                Text(tr("defect_correspondence_description"))
                    .font(.footnote)
                    .foregroundStyle(.secondary)
                TextEntry(
                    label: tr("defect_correspondence_body"),
                    text: $body_,
                    error: state.fieldErrors["bodyMd"],
                    multiline: true
                )
                TextEntry(
                    label: tr("defect_correspondence_reference"),
                    text: $reference,
                    error: state.fieldErrors["externalRef"]
                )
                Text(tr("defect_correspondence_reference_hint"))
                    .font(.footnote)
                    .foregroundStyle(.secondary)
            }
            if state.error != nil {
                Section {
                    ErrorBanner(error: state.error)
                }
            }
        }
        .onChange(of: state.done) { _, done in
            if done { dismiss() }
        }
    }
}
