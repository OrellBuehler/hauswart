import shared
import SwiftUI

/// A tappable pill; tinted while it is chosen. `fill` stretches it over the width of its grid cell.
struct ChipButton: View {
    let label: String
    let selected: Bool
    var fill = false
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            Text(label)
                .font(.subheadline)
                .lineLimit(1)
                .padding(.horizontal, 12)
                .padding(.vertical, 6)
                .frame(maxWidth: fill ? .infinity : nil)
                .foregroundStyle(selected ? Color.accentColor : Color.primary)
                .background(
                    selected ? Color.accentColor.opacity(0.18) : Color.secondary.opacity(0.12),
                    in: Capsule()
                )
        }
        .buttonStyle(.plain)
    }
}

/// Chips that wrap onto several lines. `isSelected` says which are on, `onTap` is called with a chip's value.
struct CostChipGrid: View {
    let options: [Choice]
    let isSelected: (String) -> Bool
    let onTap: (String) -> Void

    var body: some View {
        LazyVGrid(columns: [GridItem(.adaptive(minimum: 104), spacing: 8)], alignment: .leading, spacing: 8) {
            ForEach(options, id: \.value) { option in
                ChipButton(label: option.label, selected: isSelected(option.value), fill: true) {
                    onTap(option.value)
                }
            }
        }
    }
}

/// The switcher at the top of the costs screens: one row of chips that scrolls sideways.
struct BookChips: View {
    let options: [Choice]
    let selected: String
    let onSelect: (String) -> Void

    var body: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 8) {
                ForEach(options, id: \.value) { option in
                    ChipButton(label: option.label, selected: option.value == selected) {
                        onSelect(option.value)
                    }
                }
            }
            .padding(.horizontal, 16)
        }
    }
}

/// "All books" first, then every book of the switcher.
func bookChoices(_ books: [BookOption]) -> [Choice] {
    [Choice(value: "", label: tr("costbook_all"))] + books.map { Choice(value: $0.id, label: $0.name) }
}

/// A line of text in the colour of a tone the shared module names.
struct ToneLabel: View {
    let text: String
    let tone: String
    var font: Font = .body

    var body: some View {
        Text(text)
            .font(font)
            .foregroundStyle(Tone.color(tone))
    }
}

/// The badges and tags of an entry in one row.
struct CostBadges: View {
    let badges: [CostBadge]
    let tags: [TagView]

    var body: some View {
        if !badges.isEmpty || !tags.isEmpty {
            HStack(spacing: 6) {
                ForEach(badges, id: \.text) { badge in
                    Badge(text: badge.text, color: Tone.color(badge.tone))
                }
                ForEach(tags, id: \.id) { tag in
                    Badge(text: tag.name)
                }
            }
        }
    }
}

/// One entry of the list.
struct CostRowLine: View {
    let row: CostRowView

    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            VStack(alignment: .leading, spacing: 2) {
                Text(row.title)
                    .lineLimit(2)
                Text(row.meta)
                    .font(.footnote)
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
                if !row.place.isEmpty {
                    Text(row.place)
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                        .lineLimit(1)
                }
                CostBadges(badges: row.badges, tags: row.tags)
            }
            Spacer(minLength: 8)
            VStack(alignment: .trailing, spacing: 2) {
                Text(row.amount)
                    .foregroundStyle(row.refund ? Color.green : Color.primary)
                    .lineLimit(1)
                Text(row.payer)
                    .font(.footnote)
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
            }
        }
    }
}

/// A line of a form that names its section.
struct FormHeading: View {
    let text: String

    var body: some View {
        Text(text)
            .font(.footnote.weight(.semibold))
            .foregroundStyle(.secondary)
            .textCase(nil)
    }
}

/// "Tie to a bank transaction": the pending transactions of the finance app that fit the entry as typed. Sections
/// of a `Form`; tapping a transaction chooses it, tapping it again lets go. Nothing shows while there is nothing to
/// pick and nothing failed.
struct BankMatchesSection: View {
    let matches: MatchesView
    let onChoose: (String) -> Void
    let onRetry: () -> Void

    var body: some View {
        if matches.visible {
            Section {
                if matches.failed {
                    Text(tr("match_error_load"))
                        .font(.subheadline)
                    Button(matches.retryLabel) { onRetry() }
                } else {
                    Text(matches.description_)
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                    ForEach(matches.items, id: \.id) { item in
                        Button {
                            onChoose(item.id)
                        } label: {
                            HStack(alignment: .top, spacing: 12) {
                                VStack(alignment: .leading, spacing: 2) {
                                    Text(item.title)
                                        .foregroundStyle(Color.primary)
                                        .lineLimit(2)
                                    Text(item.booked)
                                        .font(.footnote)
                                        .foregroundStyle(.secondary)
                                    if item.chosen {
                                        Text(tr("match_chosen"))
                                            .font(.footnote.weight(.semibold))
                                            .foregroundStyle(Color.accentColor)
                                    }
                                }
                                Spacer()
                                Text(item.amount)
                                    .foregroundStyle(Color.primary)
                                if item.chosen {
                                    Image(systemName: "checkmark.circle.fill")
                                        .foregroundStyle(Color.accentColor)
                                }
                            }
                        }
                        .accessibilityLabel(item.label)
                    }
                }
            } header: {
                FormHeading(text: matches.title)
            }
        }
        if matches.released {
            Section {
                Text(matches.releasedNote)
                    .font(.footnote)
                    .foregroundStyle(.secondary)
            }
        }
        if let error = matches.error {
            Section {
                FieldError(text: error)
            }
        }
    }
}
