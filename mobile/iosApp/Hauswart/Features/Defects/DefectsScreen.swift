import QuickLook
import shared
import SwiftUI

struct DefectsScreen: View {
    @StateObject private var model = Observed(DefectsListStore(app: AppEnv.app))
    @State private var query = ""
    @State private var creating = false
    @State private var filtersOpen = false
    @State private var openId: String? = nil
    @State private var preview: URL? = nil
    @State private var cannotOpen = false

    var body: some View {
        let state = model.state
        content(state)
            .navigationTitle(tr("nav_defects"))
            .navigationBarTitleDisplayMode(.inline)
            .searchable(text: $query, prompt: tr("defects_search_placeholder"))
            .onChange(of: query) { _, value in
                model.store.search(query: value)
            }
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    if state.exporting {
                        ProgressView()
                    } else {
                        Button {
                            model.store.exportPdf()
                        } label: {
                            Label(tr("defects_pdf"), systemImage: "doc.richtext")
                        }
                        .disabled(state.loading)
                    }
                }
                ToolbarItem(placement: .topBarTrailing) {
                    Button {
                        creating = true
                    } label: {
                        Label(tr("defect_new"), systemImage: "plus")
                    }
                }
            }
            .sheet(isPresented: $creating) {
                DefectEditScreen(id: nil, assetId: nil, roomId: nil, embedded: false, onSaved: { id in openId = id })
            }
            .navigationDestination(item: $openId) { id in
                DefectDetailScreen(id: id)
            }
            .quickLookPreview($preview)
            .alert(tr("m_cannot_open"), isPresented: $cannotOpen) {
                Button(tr("m_common_ok"), role: .cancel) {}
            }
            .onChange(of: state.exported != nil) { _, hasExport in
                if hasExport { showExport() }
            }
    }

    @ViewBuilder
    private func content(_ state: DefectsListState) -> some View {
        if state.loading {
            LoadingView()
        } else if let error = state.error, state.total == 0 {
            ErrorView(error: error) { model.store.refresh() }
        } else {
            list(state)
        }
    }

    private func list(_ state: DefectsListState) -> some View {
        List {
            if state.actionError != nil {
                Section {
                    ErrorBanner(error: state.actionError)
                }
            }
            Section {
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: 8) {
                        ForEach(DefectLogicKt.defectStatusChoices(), id: \.value) { choice in
                            statusChip(choice, selected: state.statuses.contains(choice.value))
                        }
                    }
                }
                .listRowInsets(EdgeInsets(top: 8, leading: 16, bottom: 8, trailing: 16))
                DisclosureGroup(filterTitle(state), isExpanded: $filtersOpen) {
                    ChoiceEntry(
                        label: tr("defects_filter_severity"),
                        selection: Binding(
                            get: { model.state.severity },
                            set: { model.store.setSeverity(severity: $0) }
                        ),
                        options: defectChoices(DefectLogicKt.defectSeverityFilterChoices())
                    )
                    ChoiceEntry(
                        label: tr("defects_filter_room"),
                        selection: Binding(get: { model.state.roomId }, set: { model.store.setRoom(roomId: $0) }),
                        options: defectChoices(state.roomChoices)
                    )
                    ChoiceEntry(
                        label: tr("defects_filter_asset"),
                        selection: Binding(get: { model.state.assetId }, set: { model.store.setAsset(assetId: $0) }),
                        options: defectChoices(state.assetChoices)
                    )
                    ChoiceEntry(
                        label: tr("defects_filter_sort"),
                        selection: Binding(get: { model.state.sort }, set: { model.store.setSort(sort: $0) }),
                        options: defectChoices(DefectLogicKt.defectSortChoices())
                    )
                }
                if !state.isDefault {
                    Button(tr("tasks_filter_reset")) {
                        query = ""
                        model.store.reset()
                    }
                }
                Text(state.countText + " · " + tr("defects_pdf_scope", ["filter": state.pdfScope]))
                    .font(.footnote)
                    .foregroundStyle(.secondary)
            }
            emptyState(state)
            Section {
                ForEach(state.rows, id: \.id) { row in
                    NavigationLink(value: Route.defect(row.id)) {
                        DefectRowView(row: row)
                    }
                }
            }
        }
        .refreshable { model.store.refresh() }
    }

    private func filterTitle(_ state: DefectsListState) -> String {
        state.filterCount > 0 ? tr("tasks_filters") + " (" + String(state.filterCount) + ")" : tr("tasks_filters")
    }

    private func statusChip(_ choice: DefectChoice, selected: Bool) -> some View {
        Button {
            model.store.toggleStatus(status: choice.value)
        } label: {
            Text(choice.label)
                .font(.footnote)
                .lineLimit(1)
                .padding(.horizontal, 12)
                .padding(.vertical, 6)
                .background(
                    selected ? Color.accentColor.opacity(0.25) : Color.secondary.opacity(0.12),
                    in: Capsule()
                )
        }
        .buttonStyle(.borderless)
    }

    @ViewBuilder
    private func emptyState(_ state: DefectsListState) -> some View {
        if state.emptyReason == "empty" {
            EmptyStateView(
                title: tr("defects_empty_title"),
                message: tr("defects_empty_body"),
                systemImage: "wrench.and.screwdriver"
            )
        } else if state.emptyReason == "none_active" {
            VStack(spacing: 8) {
                EmptyStateView(
                    title: tr("defects_none_active_title"),
                    message: tr("defects_none_active_body"),
                    systemImage: "wrench.and.screwdriver"
                )
                Button(tr("defects_show_all")) { model.store.showAllStatuses() }
                    .buttonStyle(.bordered)
            }
        } else if state.emptyReason == "filtered" {
            EmptyStateView(
                title: tr("defects_empty_filtered_title"),
                message: tr("defects_empty_filtered_body"),
                systemImage: "magnifyingglass"
            )
        }
    }

    private func showExport() {
        guard let export = model.state.exported else { return }
        model.store.consumeExport()
        if let url = CacheFiles.write(export.file) {
            preview = url
        } else {
            cannotOpen = true
        }
    }
}
