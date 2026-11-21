import shared
import SwiftUI

/// One part of the list: name, number and supplier, stock, order, archive mark and price.
struct PartRowView: View {
    let row: PartRow

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack(alignment: .firstTextBaseline) {
                Text(row.name)
                    .lineLimit(2)
                Spacer(minLength: 8)
                if let price = row.priceText {
                    Text(price)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
            }
            if !row.subtitle.isEmpty {
                Text(row.subtitle)
                    .font(.footnote)
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
            }
            HStack(spacing: 6) {
                Badge(text: row.stockLabel, color: Tone.color(row.stockTone))
                if let ordered = row.orderedLabel {
                    Badge(text: ordered)
                }
                if row.archived {
                    Badge(text: tr("part_archived"))
                }
            }
        }
    }
}

/// A bar at the bottom that tells what was done and offers "Undo" when there is a way back; it goes away by itself.
struct PartNoticeBar: View {
    let notice: PartNotice
    let onUndo: (String) -> Void
    let onDismiss: () -> Void

    var body: some View {
        HStack(spacing: 12) {
            Text(notice.message)
                .font(.footnote)
                .foregroundStyle(.white)
                .lineLimit(3)
            Spacer(minLength: 8)
            if let partId = notice.undoPartId {
                Button(tr("toast_undo")) { onUndo(partId) }
                    .font(.footnote.weight(.semibold))
                    .foregroundStyle(.yellow)
            }
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 12)
        .background(Color.black.opacity(0.85), in: RoundedRectangle(cornerRadius: 12))
        .padding(.horizontal, 16)
        .padding(.bottom, 8)
        .onAppear {
            let message = notice.message
            DispatchQueue.main.asyncAfter(deadline: .now() + 6) {
                if message == notice.message { onDismiss() }
            }
        }
    }
}

/// A list of choices of which one is picked; the picked one has a check mark.
struct PartChoiceList: View {
    let options: [PartChoice]
    @Binding var selection: String

    var body: some View {
        ForEach(options, id: \.value) { option in
            Button {
                selection = option.value
            } label: {
                HStack {
                    VStack(alignment: .leading, spacing: 2) {
                        Text(option.label)
                            .foregroundStyle(Color.primary)
                            .lineLimit(1)
                        if !option.detail.isEmpty {
                            Text(option.detail)
                                .font(.footnote)
                                .foregroundStyle(.secondary)
                                .lineLimit(1)
                        }
                    }
                    Spacer()
                    if selection == option.value {
                        Image(systemName: "checkmark")
                            .foregroundStyle(Color.accentColor)
                    }
                }
            }
        }
    }
}
