import shared
import SwiftUI

struct AppointmentsScreen: View {
    @StateObject private var model = Observed(AppointmentsListStore(app: AppEnv.app))
    @State private var creating = false

    var body: some View {
        let state = model.state
        content(state)
            .navigationTitle(tr("appointments_title"))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button {
                        creating = true
                    } label: {
                        Label(tr("appointment_new"), systemImage: "plus")
                    }
                }
            }
            .sheet(isPresented: $creating) {
                AppointmentEditScreen(id: "", taskId: "", assetId: "", contactId: "", occurrenceKey: "")
            }
    }

    @ViewBuilder
    private func content(_ state: AppointmentsListState) -> some View {
        if state.loading {
            LoadingView()
        } else if let error = state.error, state.total == 0 {
            ErrorView(error: error) { model.store.refresh() }
        } else {
            List {
                Section {
                    filters(state)
                }
                if state.total == 0 {
                    Section {
                        emptyView(state)
                    }
                }
                if !state.stillOpen.isEmpty {
                    Section {
                        ForEach(state.stillOpen, id: \.id) { item in
                            NavigationLink(value: Route.appointment(item.id)) {
                                ApptRowView(item: item)
                            }
                        }
                    } header: {
                        Text(tr("appointments_open_title") + " · " + String(state.stillOpen.count))
                    } footer: {
                        Text(tr("appointments_open_hint"))
                    }
                }
                ForEach(state.days, id: \.date) { group in
                    Section(group.heading) {
                        ForEach(group.items, id: \.id) { item in
                            NavigationLink(value: Route.appointment(item.id)) {
                                ApptRowView(item: item)
                            }
                        }
                    }
                }
                if state.view == "past" {
                    Section {
                        olderRow(state)
                    }
                }
            }
            .refreshable { model.store.refresh() }
        }
    }

    private func filters(_ state: AppointmentsListState) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            Picker(tr("appointments_view_label"), selection: viewBinding) {
                ForEach(AppointmentLogicKt.APPOINTMENT_VIEWS, id: \.self) { view in
                    Text(tr("appointments_view_" + view)).tag(view)
                }
            }
            .pickerStyle(.segmented)
            HStack(spacing: 8) {
                ForEach(AppointmentLogicKt.APPOINTMENT_STATUSES, id: \.self) { status in
                    Toggle(AppointmentLogicKt.appointmentStatusLabel(status: status), isOn: statusBinding(status))
                        .toggleStyle(.button)
                }
            }
            Text(tr("appointments_count", ["count": String(state.total)]))
                .font(.footnote)
                .foregroundStyle(.secondary)
            ErrorBanner(error: state.error)
        }
    }

    @ViewBuilder
    private func emptyView(_ state: AppointmentsListState) -> some View {
        if state.filtered {
            VStack(spacing: 12) {
                EmptyStateView(
                    title: tr("appointments_empty_filtered_title"),
                    message: tr("appointments_empty_filtered_body"),
                    systemImage: "magnifyingglass"
                )
                Button(tr("appointments_filter_reset")) { model.store.resetFilters() }
                    .buttonStyle(.bordered)
            }
        } else if state.view == "upcoming" {
            VStack(spacing: 12) {
                EmptyStateView(
                    title: tr("appointments_empty_upcoming_title"),
                    message: tr("appointments_empty_upcoming_body"),
                    systemImage: "calendar"
                )
                Button(tr("appointment_new")) { creating = true }
                    .buttonStyle(.borderedProminent)
                Button(tr("appointments_show_past")) { model.store.setView(view: "past") }
                    .buttonStyle(.bordered)
            }
        } else {
            EmptyStateView(
                title: tr("appointments_empty_past_title"),
                message: tr("appointments_empty_past_body"),
                systemImage: "clock.arrow.circlepath"
            )
        }
    }

    private func olderRow(_ state: AppointmentsListState) -> some View {
        VStack(spacing: 8) {
            if state.loadingOlder {
                ProgressView()
            } else if state.olderNone {
                Text(tr("appointments_older_none"))
                    .foregroundStyle(.secondary)
            } else if !state.olderLoaded {
                Button(tr("appointments_load_older")) { model.store.loadOlder() }
                    .buttonStyle(.bordered)
            }
            ErrorBanner(error: state.olderError)
        }
        .frame(maxWidth: .infinity)
    }

    private var viewBinding: Binding<String> {
        Binding(
            get: { model.state.view },
            set: { model.store.setView(view: $0) }
        )
    }

    private func statusBinding(_ status: String) -> Binding<Bool> {
        Binding(
            get: { model.state.statuses.contains(status) },
            set: { _ in model.store.toggleStatus(status: status) }
        )
    }
}
