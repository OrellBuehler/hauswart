import shared
import SwiftUI

/// The options of a dropdown as the UI kit's `Choice`s.
func taskChoices(_ options: [ChoiceOption]) -> [Choice] {
    options.map { Choice(value: $0.value, label: $0.label) }
}

/// What a quick action or a dialog was asked to do: complete, skip or snooze one task.
struct TaskActionRequest: Identifiable {
    let taskId: String
    let mode: String
    var id: String { taskId + "/" + mode }
}

struct ProgressLine: View {
    let progress: ProgressInfo

    var body: some View {
        HStack(spacing: 8) {
            ProgressView(value: Double(progress.fraction))
                .tint(progress.reached ? Color.orange : Color.green)
            Text(progress.text)
                .font(.caption2)
                .foregroundStyle(.secondary)
                .lineLimit(1)
        }
    }
}

/// One task of a list: title, place, status and date, assignee, progress.
struct TaskRowView: View {
    let row: TaskRow

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(row.title)
                .lineLimit(2)
            if !row.place.isEmpty {
                Text(row.place)
                    .font(.footnote)
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
            }
            HStack(spacing: 8) {
                Badge(text: row.statusLabel, color: Tone.color(row.tone))
                if !row.dueText.isEmpty {
                    Text(row.dueText)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                        .lineLimit(1)
                }
            }
            if let assignee = row.assigneeName {
                Text(assignee)
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
            }
            if let archived = row.archivedLabel {
                Text(archived)
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
            if let progress = row.progress {
                ProgressLine(progress: progress)
            }
        }
    }
}

/// A bar at the bottom that tells what was done and offers "Undo"; it goes away by itself.
struct NoticeBar: View {
    let notice: TaskNotice
    let onUndo: (UndoToken) -> Void
    let onDismiss: () -> Void

    var body: some View {
        HStack(spacing: 12) {
            Text(notice.message)
                .font(.footnote)
                .foregroundStyle(.white)
                .lineLimit(3)
            Spacer(minLength: 8)
            if let undo = notice.undo {
                Button(tr("toast_undo")) { onUndo(undo) }
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
                dismissIfCurrent(message)
            }
        }
    }

    private func dismissIfCurrent(_ message: String) {
        if message == notice.message { onDismiss() }
    }
}

/// What the live preview says about the rhythm being edited.
struct PreviewSection: View {
    let preview: PreviewState

    var body: some View {
        Section(tr("preview_title")) {
            if preview.incomplete {
                Text(tr("preview_incomplete"))
                    .font(.footnote)
                    .foregroundStyle(.secondary)
            } else {
                Text(preview.summary)
                    .font(.subheadline.weight(.semibold))
                if preview.loading {
                    ProgressView()
                }
                if let error = preview.error {
                    Text(error)
                        .font(.footnote)
                        .foregroundStyle(.red)
                }
                if !preview.statusLabel.isEmpty {
                    HStack(spacing: 8) {
                        Badge(text: preview.statusLabel, color: Tone.color(preview.tone))
                        if !preview.dueText.isEmpty {
                            Text(preview.dueText)
                                .font(.caption)
                                .foregroundStyle(.secondary)
                        }
                    }
                    if let progress = preview.progress {
                        ProgressLine(progress: progress)
                    }
                    ForEach(preview.reasons, id: \.self) { reason in
                        Text("• " + reason)
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }
                    Text(tr("preview_note"))
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
            }
        }
    }
}

/// A row of choices that can be switched on and off (weekdays, months).
struct ChipGrid: View {
    let options: [ChoiceOption]
    let chosen: (String) -> Bool
    let onToggle: (String) -> Void

    var body: some View {
        LazyVGrid(columns: [GridItem(.adaptive(minimum: 48), spacing: 6)], alignment: .leading, spacing: 6) {
            ForEach(options, id: \.value) { option in
                Button {
                    onToggle(option.value)
                } label: {
                    Text(option.label)
                        .font(.footnote)
                        .lineLimit(1)
                        .frame(maxWidth: .infinity, minHeight: 32)
                        .background(
                            chosen(option.value) ? Color.accentColor.opacity(0.25) : Color.secondary.opacity(0.12),
                            in: RoundedRectangle(cornerRadius: 8)
                        )
                }
                .buttonStyle(.borderless)
            }
        }
    }
}
