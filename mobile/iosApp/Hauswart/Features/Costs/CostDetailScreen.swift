import shared
import SwiftUI

struct CostDetailScreen: View {
    private let id: String
    @StateObject private var model: Observed<CostDetailStore, CostDetailState>
    @Environment(\.dismiss) private var dismiss
    @State private var editing = false
    @State private var confirmingDelete = false

    init(id: String) {
        self.id = id
        _model = StateObject(wrappedValue: Observed(CostDetailStore(app: AppEnv.app, id: id)))
    }

    var body: some View {
        let state = model.state
        content(state)
            .navigationTitle(state.cost?.title ?? tr("nav_costs"))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                if let cost = state.cost {
                    ToolbarItem(placement: .topBarTrailing) {
                        Menu {
                            Button {
                                editing = true
                            } label: {
                                Label(tr("common_edit"), systemImage: "pencil")
                            }
                            if !cost.fuelOwned {
                                Button(role: .destructive) {
                                    confirmingDelete = true
                                } label: {
                                    Label(tr("common_delete"), systemImage: "trash")
                                }
                            }
                        } label: {
                            Label(tr("nav_costs"), systemImage: "ellipsis.circle")
                        }
                    }
                }
            }
            .sheet(isPresented: $editing) {
                CostEditScreen(id: id, bookArg: nil, assetId: nil)
            }
            .confirmDelete(
                tr("cost_delete_title"),
                message: model.store.deleteText(),
                isPresented: $confirmingDelete
            ) {
                model.store.delete()
            }
            .onChange(of: state.deleted) { _, deleted in
                if deleted { dismiss() }
            }
    }

    @ViewBuilder
    private func content(_ state: CostDetailState) -> some View {
        if let cost = state.cost {
            List {
                if state.actionError != nil {
                    Section {
                        ErrorBanner(error: state.actionError)
                    }
                }
                if let message = state.reviewedMessage {
                    Section {
                        HStack {
                            Label(message, systemImage: "checkmark.circle")
                                .font(.footnote)
                                .foregroundStyle(.green)
                            Spacer()
                            Button {
                                model.store.dismissReviewedMessage()
                            } label: {
                                Image(systemName: "xmark")
                            }
                            .buttonStyle(.borderless)
                            .accessibilityLabel(tr("common_close"))
                        }
                    }
                }
                Section {
                    VStack(alignment: .leading, spacing: 6) {
                        Text(cost.category + " · " + cost.date)
                            .font(.footnote)
                            .foregroundStyle(.secondary)
                        Text(cost.title)
                            .font(.title3.weight(.semibold))
                        Text(cost.amount)
                            .font(.title2.weight(.semibold))
                            .foregroundStyle(cost.refund ? Color.green : Color.primary)
                        CostBadges(badges: cost.badges, tags: cost.tags)
                        if let hint = cost.fuelHint {
                            Text(hint)
                                .font(.footnote)
                                .foregroundStyle(.secondary)
                        }
                    }
                }
                if cost.reviewNeeded {
                    Section {
                        Label(tr("cost_review_title"), systemImage: "eye")
                            .font(.headline)
                        Text(tr("cost_review_body"))
                            .font(.subheadline)
                        Button(state.reviewing ? tr("common_saving") : tr("cost_review_action")) {
                            model.store.markReviewed()
                        }
                        .disabled(state.reviewing)
                    }
                }
                Section(tr("cost_facts")) {
                    ForEach(cost.facts, id: \.label) { fact in
                        factRow(fact)
                    }
                }
                Section(tr("cost_shares_title") + " · " + cost.splitTitle) {
                    ForEach(cost.shares, id: \.userId) { share in
                        LabeledContent {
                            Text(share.amount)
                        } label: {
                            VStack(alignment: .leading, spacing: 2) {
                                Text(share.name)
                                Text(share.percent)
                                    .font(.footnote)
                                    .foregroundStyle(.secondary)
                            }
                        }
                    }
                    Text(cost.sharesNote)
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                }
                if let notes = cost.notes {
                    Section(tr("cost_notes")) {
                        Text(notes)
                    }
                }
                CostExtras(costId: cost.id)
            }
            .refreshable { model.store.refresh() }
        } else if let error = state.error {
            ErrorView(error: error) { model.store.refresh() }
        } else {
            LoadingView()
        }
    }

    @ViewBuilder
    private func factRow(_ fact: CostFact) -> some View {
        if let linkId = fact.linkId, let route = route(fact.linkKind, linkId) {
            NavigationLink(value: route) {
                LabeledContent(fact.label, value: fact.value)
            }
        } else {
            LabeledContent(fact.label, value: fact.value)
        }
    }

    private func route(_ kind: String?, _ id: String) -> Route? {
        switch kind {
        case "asset": Route.asset(id)
        case "room": Route.room(id)
        case "defect": Route.defect(id)
        default: nil
        }
    }
}
