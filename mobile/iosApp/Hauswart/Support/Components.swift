import shared
import SwiftUI

struct LoadingView: View {
    var body: some View {
        ProgressView()
            .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
}

struct ErrorView: View {
    let error: UiError
    let retry: () -> Void

    var body: some View {
        ContentUnavailableView {
            Label(error.message, systemImage: error.isNetwork ? "wifi.slash" : "exclamationmark.triangle")
        } actions: {
            Button(tr("common_retry"), action: retry)
                .buttonStyle(.bordered)
        }
    }
}

struct EmptyStateView: View {
    let title: String
    var message: String = ""
    var systemImage: String = "tray"

    var body: some View {
        ContentUnavailableView {
            Label(title, systemImage: systemImage)
        } description: {
            Text(message)
        }
    }
}

struct ComingSoonScreen: View {
    let title: String

    var body: some View {
        EmptyStateView(title: title, message: tr("m_coming_soon"), systemImage: "hammer")
            .navigationTitle(title)
            .navigationBarTitleDisplayMode(.inline)
    }
}

/// A message under a form field or a section; nothing when there is none.
struct FieldError: View {
    let text: String?

    var body: some View {
        if let text, !text.isEmpty {
            Text(text)
                .font(.footnote)
                .foregroundStyle(.red)
        }
    }
}

/// A banner for a failed action inside a screen that keeps showing its content.
struct ErrorBanner: View {
    let error: UiError?

    var body: some View {
        if let error {
            Label(error.message, systemImage: "exclamationmark.triangle")
                .font(.footnote)
                .foregroundStyle(.red)
        }
    }
}

struct TextEntry: View {
    let label: String
    @Binding var text: String
    var error: String? = nil
    var keyboard: UIKeyboardType = .default
    var capitalization: TextInputAutocapitalization = .sentences
    var multiline = false

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(label)
                .font(.caption)
                .foregroundStyle(.secondary)
            if multiline {
                TextField("", text: $text, axis: .vertical)
                    .lineLimit(3 ... 10)
            } else {
                TextField("", text: $text)
                    .keyboardType(keyboard)
                    .textInputAutocapitalization(capitalization)
                    .autocorrectionDisabled(keyboard != .default)
            }
            FieldError(text: error)
        }
    }
}

struct Choice: Hashable {
    let value: String
    let label: String
}

struct ChoiceEntry: View {
    let label: String
    @Binding var selection: String
    let options: [Choice]

    var body: some View {
        Picker(label, selection: $selection) {
            ForEach(options, id: \.value) { option in
                Text(option.label).tag(option.value)
            }
        }
    }
}

struct ToggleEntry: View {
    let label: String
    @Binding var isOn: Bool
    var hint: String = ""

    var body: some View {
        Toggle(isOn: $isOn) {
            VStack(alignment: .leading, spacing: 2) {
                Text(label)
                if !hint.isEmpty {
                    Text(hint)
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                }
            }
        }
    }
}

/// A calendar date as the server keeps it: `YYYY-MM-DD`, or "" for none.
struct DateEntry: View {
    let label: String
    @Binding var value: String
    var error: String? = nil
    var clearable = true

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            if value.isEmpty {
                HStack {
                    Text(label)
                    Spacer()
                    Button(tr("m_date_pick")) {
                        value = AppEnv.app.household.today()
                    }
                    .buttonStyle(.borderless)
                }
            } else {
                HStack {
                    DatePicker(label, selection: dateBinding, displayedComponents: .date)
                    if clearable {
                        Button {
                            value = ""
                        } label: {
                            Image(systemName: "xmark.circle.fill")
                                .foregroundStyle(.secondary)
                        }
                        .buttonStyle(.borderless)
                    }
                }
            }
            FieldError(text: error)
        }
    }

    private var dateBinding: Binding<Date> {
        Binding(
            get: { IsoDate.date(from: value) ?? Date() },
            set: { value = IsoDate.string(from: $0) }
        )
    }
}

/// Conversion between `YYYY-MM-DD` and the `Date` a `DatePicker` works with. Both directions use
/// the device's calendar day, so a picked day comes back as the same day.
enum IsoDate {
    private static let formatter: DateFormatter = {
        let formatter = DateFormatter()
        formatter.calendar = Calendar(identifier: .gregorian)
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.dateFormat = "yyyy-MM-dd"
        return formatter
    }()

    static func date(from value: String) -> Date? {
        formatter.date(from: value)
    }

    static func string(from date: Date) -> String {
        formatter.string(from: date)
    }
}

/// An amount as typed ("12.50"); the store parses it. `currency` is shown behind the field.
struct MoneyEntry: View {
    let label: String
    @Binding var text: String
    let currency: String
    var error: String? = nil

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(label)
                .font(.caption)
                .foregroundStyle(.secondary)
            HStack {
                TextField("", text: $text)
                    .keyboardType(.decimalPad)
                Text(currency)
                    .foregroundStyle(.secondary)
            }
            FieldError(text: error)
        }
    }
}

/// A label with its value on a detail screen; nothing when the value is empty.
struct ValueRow: View {
    let label: String
    let value: String?

    var body: some View {
        if let value, !value.isEmpty {
            LabeledContent(label) {
                Text(value)
                    .multilineTextAlignment(.trailing)
            }
        }
    }
}

struct Badge: View {
    let text: String
    var color: Color = .secondary

    var body: some View {
        Text(text)
            .font(.caption2.weight(.semibold))
            .padding(.horizontal, 6)
            .padding(.vertical, 2)
            .foregroundStyle(color)
            .background(color.opacity(0.15), in: Capsule())
    }
}

extension View {
    /// The standard confirmation before something is deleted.
    func confirmDelete(
        _ title: String,
        message: String,
        isPresented: Binding<Bool>,
        action: @escaping () -> Void
    ) -> some View {
        confirmationDialog(title, isPresented: isPresented, titleVisibility: .visible) {
            Button(tr("common_delete"), role: .destructive, action: action)
            Button(tr("common_cancel"), role: .cancel) {}
        } message: {
            Text(message)
        }
    }
}
