import shared
import SwiftUI

/// A time of day as `HH:MM`, or "" for none (when `clearable`).
struct TimeEntry: View {
    let label: String
    @Binding var value: String
    var error: String? = nil
    var clearable = false

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            if value.isEmpty {
                HStack {
                    Text(label)
                    Spacer()
                    Button(tr("m_appt_time_pick")) {
                        value = "09:00"
                    }
                    .buttonStyle(.borderless)
                }
            } else {
                HStack {
                    DatePicker(label, selection: timeBinding, displayedComponents: .hourAndMinute)
                    if clearable {
                        Button {
                            value = ""
                        } label: {
                            Image(systemName: "xmark.circle.fill")
                                .foregroundStyle(.secondary)
                        }
                        .buttonStyle(.borderless)
                        .accessibilityLabel(tr("m_appt_time_clear"))
                    }
                }
            }
            FieldError(text: error)
        }
    }

    private var timeBinding: Binding<Date> {
        Binding(
            get: { WallClock.date(from: value) ?? Date() },
            set: { value = WallClock.string(from: $0) }
        )
    }
}

/// Conversion between `HH:MM` and the `Date` a `DatePicker` works with; both directions use the
/// device's zone, so a picked time comes back as the same wall-clock time.
enum WallClock {
    private static let formatter: DateFormatter = {
        let formatter = DateFormatter()
        formatter.calendar = Calendar(identifier: .gregorian)
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.dateFormat = "HH:mm"
        return formatter
    }()

    static func date(from value: String) -> Date? {
        formatter.date(from: value)
    }

    static func string(from date: Date) -> String {
        formatter.string(from: date)
    }
}

/// A task, device or contact to link: shows the chosen one and opens a searchable list. `selection`
/// is the chosen id ("" for none). With `onPick` the caller sets the selection itself (it may change more than this field).
struct ApptChoiceEntry: View {
    let label: String
    let noneLabel: String
    let options: [ApptChoice]
    @Binding var selection: String
    var error: String? = nil
    var onPick: ((String) -> Void)? = nil

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            NavigationLink {
                ApptChoiceList(title: label, noneLabel: noneLabel, options: options, selection: $selection, onPick: onPick)
            } label: {
                LabeledContent(label) {
                    Text(shown)
                        .foregroundStyle(.secondary)
                        .lineLimit(1)
                }
            }
            FieldError(text: error)
        }
    }

    private var shown: String {
        if selection.isEmpty { return noneLabel }
        return options.first(where: { $0.id == selection })?.label ?? tr("common_loading")
    }
}

private struct ApptChoiceList: View {
    let title: String
    let noneLabel: String
    let options: [ApptChoice]
    @Binding var selection: String
    let onPick: ((String) -> Void)?

    @Environment(\.dismiss) private var dismiss
    @State private var query = ""

    var body: some View {
        List {
            Button {
                pick("")
            } label: {
                row(noneLabel, "", selection.isEmpty)
            }
            ForEach(filtered, id: \.id) { option in
                Button {
                    pick(option.id)
                } label: {
                    row(option.label, option.detail, selection == option.id)
                }
            }
            if filtered.isEmpty {
                Text(tr("m_appt_pick_empty"))
                    .foregroundStyle(.secondary)
            }
        }
        .navigationTitle(title)
        .navigationBarTitleDisplayMode(.inline)
        .searchable(text: $query, prompt: tr("m_appt_pick_search"))
    }

    private var filtered: [ApptChoice] {
        let needle = query.trimmingCharacters(in: .whitespaces).lowercased()
        if needle.isEmpty { return options }
        return options.filter { ($0.label + " " + $0.detail).lowercased().contains(needle) }
    }

    private func pick(_ id: String) {
        if let onPick {
            onPick(id)
        } else {
            selection = id
        }
        dismiss()
    }

    private func row(_ title: String, _ detail: String, _ selected: Bool) -> some View {
        HStack {
            VStack(alignment: .leading, spacing: 2) {
                Text(title)
                    .foregroundStyle(Color.primary)
                if !detail.isEmpty {
                    Text(detail)
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                }
            }
            Spacer(minLength: 0)
            if selected {
                Image(systemName: "checkmark")
                    .foregroundStyle(Color.accentColor)
            }
        }
    }
}

/// One appointment as a row of a list: the time on the left, the title and where below it.
struct ApptRowView: View {
    let item: ApptItem

    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            VStack(alignment: .leading, spacing: 2) {
                Text(item.timePrimary)
                    .font(.subheadline.weight(.semibold))
                    .lineLimit(1)
                if !item.timeSecondary.isEmpty {
                    Text(item.timeSecondary)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                        .lineLimit(1)
                }
            }
            .frame(width: 64, alignment: .leading)
            VStack(alignment: .leading, spacing: 2) {
                Text(item.title)
                    .lineLimit(2)
                    .strikethrough(item.cancelled)
                if !subtitle.isEmpty {
                    Text(subtitle)
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                        .lineLimit(2)
                }
                if item.needsClosing {
                    Badge(text: tr("appointment_open_badge"), color: .orange)
                } else if item.status != "planned" {
                    Badge(text: item.statusLabel, color: item.status == "done" ? .green : .secondary)
                }
            }
        }
    }

    private var subtitle: String {
        [item.location, item.taskTitle, item.assetName, item.contactName]
            .filter { !$0.isEmpty }
            .joined(separator: " · ")
    }
}
