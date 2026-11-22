import shared
import SwiftUI

func vehicleChoices(_ options: [VehicleChoice]) -> [Choice] {
    options.map { Choice(value: $0.value, label: $0.label) }
}

/// A message after an action with a button that dismisses it. Put it in its own `Section` of a `List`.
struct VehicleNotice: View {
    let text: String?
    let dismiss: () -> Void

    var body: some View {
        if let text {
            HStack(spacing: 12) {
                Text(text)
                    .font(.footnote)
                Spacer()
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

/// A label with its value; a note under it. A warning shows in red.
struct VehicleFactRow: View {
    let fact: VehicleFact

    var body: some View {
        VStack(alignment: .leading, spacing: 2) {
            LabeledContent(fact.label) {
                Text(fact.value)
                    .multilineTextAlignment(.trailing)
                    .foregroundStyle(fact.warning ? Color.red : Color.primary)
            }
            if let note = fact.note {
                Text(note)
                    .font(.caption)
                    .foregroundStyle(fact.warning ? Color.red : Color.secondary)
            }
        }
    }
}

/// A line drawing of a trend; nothing for fewer than two points.
struct VehicleSparkline: View {
    let points: [SparkPoint]

    var body: some View {
        if points.count >= 2 {
            GeometryReader { geo in
                Path { path in
                    for (index, point) in points.enumerated() {
                        let x = 6 + (geo.size.width - 12) * CGFloat(point.x)
                        let y = 6 + (geo.size.height - 12) * CGFloat(point.y)
                        if index == 0 {
                            path.move(to: CGPoint(x: x, y: y))
                        } else {
                            path.addLine(to: CGPoint(x: x, y: y))
                        }
                    }
                }
                .stroke(Color.accentColor, style: StrokeStyle(lineWidth: 2, lineCap: .round, lineJoin: .round))
            }
            .frame(height: 48)
            .background(Color(.tertiarySystemFill), in: RoundedRectangle(cornerRadius: 8))
        }
    }
}

/// A horizontal bar filled to `fraction` (0 to 1).
struct VehicleBar: View {
    let fraction: Double

    var body: some View {
        ProgressView(value: min(max(fraction, 0), 1), total: 1)
    }
}
