import shared
import SwiftUI

func assetKindSymbol(_ kind: String) -> String {
    switch kind {
    case "device": return "cpu"
    case "plant": return "leaf"
    case "fixture": return "door.left.hand.closed"
    case "vehicle": return "car"
    default: return "shippingbox"
    }
}

func hintKindSymbol(_ kind: String) -> String {
    switch kind {
    case "warning": return "exclamationmark.triangle"
    case "rule": return "scroll"
    default: return "lightbulb"
    }
}

func roomSymbol(_ icon: String?) -> String {
    switch icon ?? "" {
    case "cooking-pot": return "fork.knife"
    case "bath": return "bathtub"
    case "shower-head": return "shower"
    case "toilet": return "toilet"
    case "sofa": return "sofa"
    case "armchair": return "chair.lounge"
    case "bed": return "bed.double"
    case "bed-double": return "bed.double.fill"
    case "baby": return "figure.and.child.holdinghands"
    case "tv": return "tv"
    case "monitor": return "desktopcomputer"
    case "book-open": return "book"
    case "shirt": return "tshirt"
    case "washing-machine": return "washer"
    case "warehouse": return "building.2"
    case "archive": return "archivebox"
    case "flower-2": return "camera.macro"
    case "trees": return "tree"
    case "car": return "car"
    case "hammer": return "hammer"
    case "dumbbell": return "dumbbell"
    case "gamepad-2": return "gamecontroller"
    case "house": return "house"
    default: return "door.left.hand.open"
    }
}

/// What a "new asset" sheet starts with.
struct AssetCreation: Identifiable {
    let id = UUID()
    let kind: String
    let roomId: String?
}

func choices(_ options: [InventoryChoice]) -> [Choice] {
    options.map { Choice(value: $0.value, label: $0.label) }
}

/// A message after an action, with the actions the notice offers. Put it in its own `Section` of a `List`.
struct NoticeBanner: View {
    let notice: InventoryNotice?
    var undo: (() -> Void)? = nil
    let dismiss: () -> Void

    var body: some View {
        if let notice {
            HStack(spacing: 12) {
                Text(notice.message)
                    .font(.footnote)
                Spacer()
                if notice.undo, let undo {
                    Button(tr("common_undo")) { undo() }
                        .buttonStyle(.borderless)
                }
                if let defectId = notice.defectId {
                    NavigationLink(value: Route.defect(defectId)) {
                        Text(tr("asset_notes_open_defect"))
                            .font(.footnote)
                    }
                    .fixedSize()
                }
                Button {
                    dismiss()
                } label: {
                    Image(systemName: "xmark")
                }
                .buttonStyle(.borderless)
            }
        }
    }
}

/// A form in a sheet with cancel and save in the navigation bar.
struct SheetForm<Content: View>: View {
    let title: String
    var saveLabel: String? = nil
    let saving: Bool
    let onSave: () -> Void
    @ViewBuilder let content: () -> Content
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            Form {
                content()
            }
            .navigationTitle(title)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button(tr("common_cancel")) { dismiss() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button(saving ? tr("common_saving") : (saveLabel ?? tr("common_save"))) {
                        onSave()
                    }
                    .disabled(saving)
                }
            }
        }
    }
}

struct AssetRowView: View {
    let row: AssetRow

    var body: some View {
        HStack(spacing: 12) {
            Image(systemName: assetKindSymbol(row.kind))
                .frame(width: 28)
                .foregroundStyle(.secondary)
            VStack(alignment: .leading, spacing: 2) {
                Text(row.name)
                    .lineLimit(1)
                if !row.subtitle.isEmpty {
                    Text(row.subtitle)
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                        .lineLimit(1)
                }
                if row.archived {
                    Badge(text: tr("asset_archived"))
                } else if let warranty = row.warranty {
                    Badge(text: warranty.label, color: Tone.color(warranty.tone))
                }
            }
        }
    }
}

struct TaskLineRow: View {
    let line: TaskLine
    var showAsset = false

    var body: some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(line.title)
                .lineLimit(1)
            HStack(spacing: 6) {
                Badge(text: line.statusLabel, color: Tone.color(line.tone))
                if showAsset, let assetName = line.assetName {
                    Text(assetName)
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                        .lineLimit(1)
                } else if let dateText = line.dateText {
                    Text(dateText)
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                }
            }
        }
    }
}

/// A titled card of the asset screen. Sections of an asset live in a `ScrollView` of these, not in a
/// `List`: a sheet or dialog attached to a row of a lazy list is lost when the row scrolls away.
struct CardSection<Content: View>: View {
    let title: String
    @ViewBuilder let content: () -> Content

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            if !title.isEmpty {
                Text(title)
                    .font(.headline)
            }
            content()
        }
        .padding()
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Color(.secondarySystemGroupedBackground), in: RoundedRectangle(cornerRadius: 12))
    }
}

/// A row of a card that opens a route.
struct LinkRow<Content: View>: View {
    let route: Route
    @ViewBuilder let content: () -> Content

    var body: some View {
        NavigationLink(value: route) {
            HStack {
                content()
                Spacer()
                Image(systemName: "chevron.right")
                    .font(.footnote)
                    .foregroundStyle(.secondary)
            }
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
    }
}
