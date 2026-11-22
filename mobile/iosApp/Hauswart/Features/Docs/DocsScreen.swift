import shared
import SwiftUI

struct DocsScreen: View {
    @StateObject private var model = Observed(DocsListStore(app: AppEnv.app))
    @State private var query = ""
    @State private var creating = false
    @State private var opened: Route? = nil

    var body: some View {
        let state = model.state
        content(state)
            .navigationTitle(tr("nav_docs"))
            .navigationBarTitleDisplayMode(.inline)
            .searchable(text: $query, prompt: tr("docs_search_placeholder"))
            .onChange(of: query) { _, value in
                model.store.search(query: value)
            }
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button {
                        creating = true
                    } label: {
                        Label(tr("docs_new"), systemImage: "plus")
                    }
                }
            }
            .sheet(isPresented: $creating) {
                DocEditScreen(slug: nil, section: state.section, assetId: "", roomId: "", title: "") { slug in
                    opened = .doc(slug)
                }
            }
            .navigationDestination(item: $opened) { route in
                destination(for: route)
            }
    }

    @ViewBuilder
    private func content(_ state: DocsListState) -> some View {
        if state.loading {
            LoadingView()
        } else if let error = state.error, !state.loaded {
            ErrorView(error: error) { model.store.refresh() }
        } else {
            List {
                Section {
                    Picker(tr("docs_field_section"), selection: sectionBinding) {
                        Text(tr("docs_filter_all_sections")).tag("")
                        ForEach(DocsStoresKt.DOC_SECTIONS, id: \.self) { section in
                            Text(DocsStoresKt.docSectionLabel(section: section)).tag(section)
                        }
                    }
                    Toggle(tr("docs_show_archived"), isOn: archivedBinding)
                    if state.filtered || state.archived {
                        Button(tr("docs_filter_reset")) {
                            query = ""
                            model.store.resetFilters()
                        }
                    }
                    Text(tr("docs_count", ["count": state.shown]))
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                }
                if let error = state.error {
                    Section {
                        ErrorBanner(error: error)
                    }
                }
                if state.groups.isEmpty {
                    if state.filtered || state.archived {
                        EmptyStateView(
                            title: tr("docs_no_results_title"),
                            message: tr("docs_no_results_body"),
                            systemImage: "magnifyingglass"
                        )
                    } else {
                        EmptyStateView(
                            title: tr("docs_empty_title"),
                            message: tr("docs_empty_body"),
                            systemImage: "doc.text"
                        )
                    }
                }
                ForEach(state.groups, id: \.key) { group in
                    Section(group.title) {
                        ForEach(group.rows, id: \.slug) { row in
                            NavigationLink(value: Route.doc(row.slug)) {
                                DocRowView(row: row)
                            }
                        }
                    }
                }
            }
            .refreshable { model.store.refresh() }
        }
    }

    private var sectionBinding: Binding<String> {
        Binding(
            get: { model.state.section },
            set: { model.store.setSection(section: $0) }
        )
    }

    private var archivedBinding: Binding<Bool> {
        Binding(
            get: { model.state.archived },
            set: { model.store.setArchived(value: $0) }
        )
    }
}

private struct DocRowView: View {
    let row: DocRowItem

    var body: some View {
        VStack(alignment: .leading, spacing: 2) {
            HStack(spacing: 6) {
                if row.pinned {
                    Image(systemName: "pin.fill")
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                }
                Text(row.title)
                    .lineLimit(1)
                if row.archived {
                    Badge(text: tr("docs_archived"))
                }
            }
            if !row.excerpt.isEmpty {
                Text(row.excerpt)
                    .font(.footnote)
                    .foregroundStyle(.secondary)
                    .lineLimit(2)
            }
            Text([row.places, row.updated].filter { !$0.isEmpty }.joined(separator: " · "))
                .font(.caption)
                .foregroundStyle(.secondary)
                .lineLimit(1)
        }
    }
}
