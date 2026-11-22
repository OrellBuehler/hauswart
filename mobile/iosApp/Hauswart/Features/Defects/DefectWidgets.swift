import shared
import SwiftUI

/// Text with its web addresses as links.
func defectLinkedText(_ segments: [TextSegment]) -> AttributedString {
    var result = AttributedString()
    for segment in segments {
        var part = AttributedString(segment.text)
        if let href = segment.href, let url = URL(string: href) {
            part.link = url
        }
        result.append(part)
    }
    return result
}

func defectChoices(_ options: [DefectChoice]) -> [Choice] {
    options.map { Choice(value: $0.value, label: $0.label) }
}

/// One defect of the list: number and title, place, status, severity, deadline and the comment count.
struct DefectRowView: View {
    let row: DefectRow

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack(alignment: .firstTextBaseline) {
                Text("#" + String(row.number) + " " + row.title)
                    .lineLimit(2)
                Spacer(minLength: 8)
                if row.commentCount > 0 {
                    Label(String(row.commentCount), systemImage: "bubble.left")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
            }
            if !row.place.isEmpty {
                Text(row.place)
                    .font(.footnote)
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
            }
            HStack(spacing: 6) {
                Badge(text: row.statusLabel, color: Tone.color(row.statusTone))
                Badge(text: row.severityLabel, color: Tone.color(row.severityTone))
            }
            Text(row.deadlineText)
                .font(.caption)
                .foregroundStyle(Tone.color(row.deadlineTone))
                .lineLimit(2)
        }
    }
}

/// The progress of a defect: open, reported, in progress, fixed (or rejected), with the dates that are known.
struct DefectStepperView: View {
    let steps: [DefectStep]

    var body: some View {
        HStack(alignment: .top, spacing: 2) {
            ForEach(Array(steps.enumerated()), id: \.offset) { index, step in
                VStack(spacing: 4) {
                    ZStack {
                        Circle()
                            .fill(step.state == "current" ? Color.accentColor : Color.secondary.opacity(0.2))
                            .frame(width: 32, height: 32)
                        if step.state == "done" {
                            Image(systemName: "checkmark")
                                .font(.footnote)
                        } else {
                            Text(String(index + 1))
                                .font(.footnote)
                                .foregroundStyle(step.state == "current" ? Color.white : Color.secondary)
                        }
                    }
                    Text(step.label)
                        .font(.caption2)
                        .multilineTextAlignment(.center)
                        .foregroundStyle(step.state == "todo" ? Color.secondary : Color.primary)
                    if let dateText = step.dateText {
                        Text(dateText)
                            .font(.caption2)
                            .foregroundStyle(.secondary)
                    }
                }
                .frame(maxWidth: .infinity)
            }
        }
    }
}

/// One entry of the history of a defect.
struct DefectEventView: View {
    let event: DefectEventRow

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(event.title)
                .font(.subheadline)
            Text(event.relativeText + " · " + event.absoluteText)
                .font(.caption)
                .foregroundStyle(.secondary)
            if event.fromLabel != nil || event.toLabel != nil {
                HStack(spacing: 6) {
                    if let from = event.fromLabel {
                        Badge(text: from, color: Tone.color(event.fromTone))
                    }
                    if let to = event.toLabel {
                        Badge(text: to, color: Tone.color(event.toTone))
                    }
                }
            }
            if !event.body.isEmpty {
                Text(defectLinkedText(event.body))
                    .font(.subheadline)
            }
            if !event.reference.isEmpty {
                (Text(tr("defect_event_reference") + ": ") + Text(defectLinkedText(event.reference)))
                    .font(.caption)
            }
        }
    }
}
