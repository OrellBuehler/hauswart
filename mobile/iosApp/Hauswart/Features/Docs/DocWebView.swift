import shared
import SwiftUI
import WebKit

/// A rendered documentation page in a web view with JavaScript off, in the colours of the app.
/// `onLink` gets the address of a tapped link and returns true when it dealt with it; false lets the
/// view follow it (a jump inside the page). Give it a bounded height: it scrolls by itself.
struct DocWebView: UIViewRepresentable {
    let bodyHtml: String
    let dark: Bool
    let onLink: (String) -> Bool

    func makeCoordinator() -> Coordinator {
        Coordinator(onLink: onLink)
    }

    func makeUIView(context: Context) -> WKWebView {
        let configuration = WKWebViewConfiguration()
        configuration.defaultWebpagePreferences.allowsContentJavaScript = false
        let view = WKWebView(frame: .zero, configuration: configuration)
        view.navigationDelegate = context.coordinator
        view.isOpaque = false
        view.backgroundColor = .clear
        view.scrollView.backgroundColor = .clear
        return view
    }

    func updateUIView(_ view: WKWebView, context: Context) {
        context.coordinator.onLink = onLink
        let html = DocHtmlKt.docDocument(bodyHtml: bodyHtml, dark: dark)
        if context.coordinator.loaded != html {
            context.coordinator.loaded = html
            view.loadHTMLString(html, baseURL: URL(string: DocHtmlKt.DOC_BASE_URL))
        }
    }

    final class Coordinator: NSObject, WKNavigationDelegate {
        var onLink: (String) -> Bool
        var loaded = ""

        init(onLink: @escaping (String) -> Bool) {
            self.onLink = onLink
        }

        func webView(
            _ webView: WKWebView,
            decidePolicyFor navigationAction: WKNavigationAction,
            decisionHandler: @escaping (WKNavigationActionPolicy) -> Void
        ) {
            guard navigationAction.navigationType == .linkActivated, let url = navigationAction.request.url else {
                decisionHandler(.allow)
                return
            }
            decisionHandler(onLink(url.absoluteString) ? .cancel : .allow)
        }
    }
}

/// What a tap on a link of a rendered page does: a page or device of the app is pushed, a file is
/// fetched and shown, an external address goes to the system. Returns true when the tap was dealt
/// with. `push` shows a screen of the app.
@MainActor
func handleDocLink(
    _ target: DocLinkTarget,
    openURL: OpenURLAction,
    push: (Route) -> Void,
    attachment: (String) -> Void,
    cannotOpen: () -> Void
) -> Bool {
    switch target.kind {
    case DocHtmlKt.DOC_LINK_ANCHOR:
        return false
    case DocHtmlKt.DOC_LINK_ATTACHMENT:
        attachment(target.value)
    case DocHtmlKt.DOC_LINK_APP:
        if let link = target.link, let route = Route.from(link: link) {
            push(route)
        } else {
            cannotOpen()
        }
    case DocHtmlKt.DOC_LINK_EXTERNAL:
        if let url = URL(string: target.value) {
            openURL(url)
        } else {
            cannotOpen()
        }
    default:
        cannotOpen()
    }
    return true
}

/// A message that goes away by itself, at the bottom of a screen.
struct KnowledgeNoticeBar: View {
    let text: String
    let onDismiss: () -> Void

    var body: some View {
        Text(text)
            .font(.footnote)
            .foregroundStyle(.white)
            .lineLimit(3)
            .padding(.horizontal, 16)
            .padding(.vertical, 12)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(Color.black.opacity(0.85), in: RoundedRectangle(cornerRadius: 12))
            .padding(.horizontal, 16)
            .padding(.bottom, 8)
            .onAppear {
                let shown = text
                DispatchQueue.main.asyncAfter(deadline: .now() + 4) {
                    if shown == text { onDismiss() }
                }
            }
    }
}

/// A searchable list of choices that closes when one is picked. `selection` is the chosen id ("" for none).
struct PickEntry: View {
    let label: String
    let noneLabel: String
    let options: [PickChoice]
    @Binding var selection: String
    var error: String? = nil

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            NavigationLink {
                PickList(
                    title: label,
                    noneLabel: noneLabel,
                    options: options,
                    selected: [selection],
                    multiple: false,
                    onPick: { id in selection = id }
                )
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

/// Several choices, ticked in a searchable list. `selection` holds the chosen ids.
struct MultiPickEntry: View {
    let label: String
    let emptyText: String
    let options: [PickChoice]
    @Binding var selection: [String]
    var error: String? = nil

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            NavigationLink {
                PickList(
                    title: label,
                    noneLabel: "",
                    options: options,
                    selected: selection,
                    multiple: true,
                    onPick: { id in toggle(id) }
                )
            } label: {
                LabeledContent(label) {
                    Text(shown)
                        .foregroundStyle(.secondary)
                        .lineLimit(2)
                }
            }
            Text(tr("insurance_assets_selected", ["count": selection.count]))
                .font(.footnote)
                .foregroundStyle(.secondary)
            FieldError(text: error)
        }
    }

    private var shown: String {
        if selection.isEmpty { return emptyText }
        let names = selection.compactMap { id in options.first(where: { $0.id == id })?.label }
        return names.joined(separator: ", ")
    }

    private func toggle(_ id: String) {
        if selection.contains(id) {
            selection = selection.filter { $0 != id }
        } else {
            selection = selection + [id]
        }
    }
}

struct PickChoice: Hashable {
    let id: String
    let label: String
    let detail: String
}

private struct PickList: View {
    let title: String
    let noneLabel: String
    let options: [PickChoice]
    let selected: [String]
    let multiple: Bool
    let onPick: (String) -> Void

    @Environment(\.dismiss) private var dismiss
    @State private var query = ""
    @State private var ticked: [String] = []

    var body: some View {
        List {
            if !multiple {
                Button {
                    pick("")
                } label: {
                    row(noneLabel, "", ticked.contains("") || ticked.isEmpty)
                }
            }
            ForEach(filtered, id: \.id) { option in
                Button {
                    pick(option.id)
                } label: {
                    row(option.label, option.detail, ticked.contains(option.id))
                }
            }
            if filtered.isEmpty {
                Text(tr("m_pick_empty"))
                    .foregroundStyle(.secondary)
            }
        }
        .navigationTitle(title)
        .navigationBarTitleDisplayMode(.inline)
        .searchable(text: $query, prompt: tr("m_pick_search"))
        .onAppear { ticked = selected }
    }

    private var filtered: [PickChoice] {
        let needle = query.trimmingCharacters(in: .whitespaces).lowercased()
        if needle.isEmpty { return options }
        return options.filter { ($0.label + " " + $0.detail).lowercased().contains(needle) }
    }

    private func pick(_ id: String) {
        onPick(id)
        if multiple {
            if ticked.contains(id) {
                ticked = ticked.filter { $0 != id }
            } else {
                ticked = ticked + [id]
            }
        } else {
            dismiss()
        }
    }

    private func row(_ title: String, _ detail: String, _ isOn: Bool) -> some View {
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
            Spacer()
            if isOn {
                Image(systemName: "checkmark")
                    .foregroundStyle(Color.accentColor)
            }
        }
    }
}
