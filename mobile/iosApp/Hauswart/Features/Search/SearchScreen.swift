import shared
import SwiftUI

struct SearchScreen: View {
    @StateObject private var model = Observed(SearchStore(app: AppEnv.app))
    @State private var query = ""

    var body: some View {
        let state = model.state
        content(state)
            .navigationTitle(tr("search_page_title"))
            .navigationBarTitleDisplayMode(.inline)
            .searchable(text: $query, placement: .navigationBarDrawer(displayMode: .always), prompt: tr("search_placeholder"))
            .onChange(of: query) { _, value in
                model.store.setQuery(query: value)
            }
    }

    @ViewBuilder
    private func content(_ state: SearchState) -> some View {
        if state.idle {
            EmptyStateView(title: tr("search_page_idle_title"), message: tr("search_idle"), systemImage: "magnifyingglass")
        } else if let error = state.error {
            ErrorView(error: error) { model.store.retry() }
        } else if state.loading && state.groups.isEmpty {
            LoadingView()
        } else if state.empty {
            EmptyStateView(
                title: tr("search_page_empty_title"),
                message: tr("search_empty", ["q": query.trimmingCharacters(in: .whitespaces)]),
                systemImage: "magnifyingglass"
            )
        } else {
            List {
                if !state.filters.isEmpty {
                    Section {
                        ScrollView(.horizontal, showsIndicators: false) {
                            HStack(spacing: 8) {
                                ForEach(state.filters, id: \.type) { filter in
                                    Toggle(filter.title + " " + String(filter.count), isOn: filterBinding(filter.type))
                                        .toggleStyle(.button)
                                }
                            }
                        }
                    }
                }
                Section {
                    Text(tr("search_result_count", ["count": String(state.shown), "q": query.trimmingCharacters(in: .whitespaces)]))
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                }
                ForEach(state.groups, id: \.type) { group in
                    Section(group.title) {
                        ForEach(group.hits, id: \.key) { hit in
                            hitRow(hit)
                        }
                    }
                }
            }
        }
    }

    @ViewBuilder
    private func hitRow(_ hit: SearchHitRow) -> some View {
        if let link = hit.link, let route = Route.from(link: link) {
            NavigationLink(value: route) {
                HitView(hit: hit)
            }
        } else {
            HitView(hit: hit)
        }
    }

    private func filterBinding(_ type: String) -> Binding<Bool> {
        Binding(
            get: { model.state.type == type },
            set: { _ in model.store.setType(type: type) }
        )
    }
}

private struct HitView: View {
    let hit: SearchHitRow

    var body: some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(hit.title)
                .lineLimit(2)
            if !hit.snippet.isEmpty {
                Text(hit.snippet)
                    .font(.footnote)
                    .foregroundStyle(.secondary)
                    .lineLimit(2)
            }
        }
    }
}
