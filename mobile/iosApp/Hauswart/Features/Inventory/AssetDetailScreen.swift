import shared
import SwiftUI

struct AssetDetailScreen: View {
    private let id: String
    @StateObject private var model: Observed<AssetDetailStore, AssetDetailState>
    @Environment(\.dismiss) private var dismiss
    @State private var editing: AssetEditRequest?
    @State private var confirmingDelete = false

    init(id: String) {
        self.id = id
        _model = StateObject(wrappedValue: Observed(AssetDetailStore(app: AppEnv.app, id: id)))
    }

    var body: some View {
        let state = model.state
        content(state)
            .navigationTitle(state.asset?.name ?? tr("nav_inventory"))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                if let asset = state.asset {
                    ToolbarItem(placement: .topBarTrailing) {
                        Menu {
                            Button {
                                editing = AssetEditRequest()
                            } label: {
                                Label(tr("common_edit"), systemImage: "pencil")
                            }
                            Button {
                                model.store.toggleArchive()
                            } label: {
                                Label(
                                    asset.archived ? tr("asset_restore") : tr("asset_archive"),
                                    systemImage: asset.archived ? "tray.and.arrow.up" : "archivebox"
                                )
                            }
                            .disabled(state.busy)
                            Button(role: .destructive) {
                                confirmingDelete = true
                            } label: {
                                Label(tr("common_delete"), systemImage: "trash")
                            }
                            .disabled(state.busy)
                        } label: {
                            Label(tr("asset_actions"), systemImage: "ellipsis.circle")
                        }
                    }
                }
            }
            .sheet(item: $editing) { _ in
                AssetEditScreen(id: id, kind: "device", roomId: nil)
            }
            .confirmDelete(
                tr("asset_delete_title"),
                message: tr("asset_delete_description", ["name": state.asset?.name ?? ""]),
                isPresented: $confirmingDelete
            ) {
                model.store.delete()
            }
            .onChange(of: state.deleted) { _, deleted in
                if deleted { dismiss() }
            }
    }

    @ViewBuilder
    private func content(_ state: AssetDetailState) -> some View {
        if let asset = state.asset {
            ScrollView {
                VStack(spacing: 16) {
                    if state.notice != nil && !state.deleted {
                        CardSection(title: "") {
                            NoticeBanner(notice: state.notice, dismiss: { model.store.dismissNotice() })
                        }
                    }
                    if state.actionError != nil {
                        CardSection(title: "") {
                            ErrorBanner(error: state.actionError)
                        }
                    }
                    header(asset)
                    AssetVehicleSection(assetId: id)
                    facts(asset)
                    tasks(state)
                    AssetNotesSection(assetId: id)
                    AssetHintsSection(assetId: id)
                    AssetContactsSection(assetId: id)
                    AssetPartsSection(assetId: id)
                    AssetServiceLogSection(assetId: id)
                    AssetExtras(assetId: id)
                }
                .padding()
            }
            .background(Color(.systemGroupedBackground))
            .refreshable { model.store.refresh() }
        } else if let error = state.error {
            ErrorView(error: error) { model.store.refresh() }
        } else {
            LoadingView()
        }
    }

    private func header(_ asset: AssetView) -> some View {
        CardSection(title: "") {
            Label(asset.name, systemImage: assetKindSymbol(asset.kind))
                .font(.headline)
            LabeledContent(tr("asset_kind"), value: asset.plate == nil ? asset.kindLabel : asset.kindLabel + " · " + (asset.plate ?? ""))
            if let roomId = asset.roomId, let roomName = asset.roomName {
                LinkRow(route: Route.room(roomId)) {
                    LabeledContent(tr("asset_room"), value: roomName)
                }
            }
            if asset.archived {
                Badge(text: tr("asset_archived"))
            }
        }
    }

    private func facts(_ asset: AssetView) -> some View {
        CardSection(title: tr("asset_facts_title")) {
            if let warranty = asset.warranty {
                VStack(alignment: .leading, spacing: 4) {
                    Text(tr("asset_warranty"))
                        .font(.caption)
                        .foregroundStyle(.secondary)
                    Badge(text: warranty.label, color: Tone.color(warranty.tone))
                    if let daysText = warranty.daysText {
                        Text(daysText)
                            .font(.footnote)
                    }
                    if let detail = asset.warrantyDetail {
                        Text(detail)
                            .font(.footnote)
                    }
                    if asset.warrantyFromDocument {
                        Text(tr("asset_warranty_from_document"))
                            .font(.footnote)
                            .foregroundStyle(.secondary)
                    }
                }
            }
            ForEach(asset.facts, id: \.label) { fact in
                ValueRow(label: fact.label, value: fact.value)
            }
            LabeledContent(tr("asset_emergency_short"), value: asset.showOnEmergency ? tr("common_yes") : tr("common_no"))
            ValueRow(label: tr("asset_notes"), value: asset.notes)
            if asset.isVehicle {
                Text(tr("m_asset_vehicle_hint"))
                    .font(.footnote)
                    .foregroundStyle(.secondary)
            }
        }
    }

    private func tasks(_ state: AssetDetailState) -> some View {
        CardSection(title: tr("asset_tasks_title")) {
            if state.tasks.isEmpty {
                Text(tr("asset_tasks_empty_title"))
                    .foregroundStyle(.secondary)
            }
            ForEach(state.tasks, id: \.id) { line in
                LinkRow(route: Route.task(line.id)) {
                    TaskLineRow(line: line)
                }
                Divider()
            }
            LinkRow(route: Route.taskNew(id)) {
                Label(tr("asset_add_task"), systemImage: "plus")
            }
        }
    }
}

private struct AssetEditRequest: Identifiable {
    let id = UUID()
}
