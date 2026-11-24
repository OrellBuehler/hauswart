package ch.orellbuehler.hauswart.feature.tasks

/** A preparation as the form edits it; [id] is empty for one that does not exist yet. */
data class PreparationForm(
    val key: String,
    val id: String = "",
    val title: String = "",
    val kind: String = "generic",
    val leadDays: String = "7",
)

/**
 * The task form: every field as typed. Screens read a field with [valueOf] and change it with
 * [withField] so that they never copy this class.
 */
data class TaskForm(
    val title: String = "",
    val description: String = "",
    val category: String = "maintenance",
    val priority: String = "normal",
    val effort: String = "",
    val assetId: String = "",
    val roomId: String = "",
    val trigger: TriggerForm = TriggerForm(),
    val assignMode: String = "none",
    val assigneeUserId: String = "",
    val rotationOrder: List<String> = emptyList(),
    val rotationStrategy: String = "alternate",
    val notifyMode: String = "assignee",
    val graceDays: String = "0",
    val dueSoonDays: String = "",
    val preparations: List<PreparationForm> = emptyList(),
) {
    fun valueOf(field: String): String =
        when (field) {
            "title" -> title
            "description" -> description
            "category" -> category
            "priority" -> priority
            "effort" -> effort
            "assetId" -> assetId
            "roomId" -> roomId
            "assignMode" -> assignMode
            "assigneeUserId" -> assigneeUserId
            "rotationStrategy" -> rotationStrategy
            "notifyMode" -> notifyMode
            "graceDays" -> graceDays
            "dueSoonDays" -> dueSoonDays
            else -> ""
        }

    fun withField(
        field: String,
        text: String,
    ): TaskForm =
        when (field) {
            "title" -> copy(title = text)
            "description" -> copy(description = text)
            "category" -> copy(category = text)
            "priority" -> copy(priority = text)
            "effort" -> copy(effort = text)
            "assetId" -> copy(assetId = text)
            "roomId" -> copy(roomId = text)
            "assignMode" -> copy(assignMode = text)
            "assigneeUserId" -> copy(assigneeUserId = text)
            "rotationStrategy" -> copy(rotationStrategy = text)
            "notifyMode" -> copy(notifyMode = text)
            "graceDays" -> copy(graceDays = text)
            "dueSoonDays" -> copy(dueSoonDays = text)
            else -> this
        }

    fun withTrigger(next: TriggerForm): TaskForm = copy(trigger = next)

    fun addRotation(userId: String): TaskForm =
        if (userId.isEmpty() ||
            userId in rotationOrder
        ) {
            this
        } else {
            copy(rotationOrder = rotationOrder + userId)
        }

    fun removeRotation(index: Int): TaskForm = copy(rotationOrder = rotationOrder.filterIndexed { i, _ -> i != index })

    fun moveRotation(
        index: Int,
        delta: Int,
    ): TaskForm {
        val target = index + delta
        if (index !in rotationOrder.indices || target !in rotationOrder.indices) return this
        val next = rotationOrder.toMutableList()
        next[index] = rotationOrder[target]
        next[target] = rotationOrder[index]
        return copy(rotationOrder = next)
    }

    fun addPreparation(key: String): TaskForm = copy(preparations = preparations + PreparationForm(key = key))

    fun removePreparation(key: String): TaskForm = copy(preparations = preparations.filter { it.key != key })

    fun withPreparation(
        key: String,
        field: String,
        text: String,
    ): TaskForm =
        copy(
            preparations =
                preparations.map { p ->
                    if (p.key != key) {
                        p
                    } else {
                        when (field) {
                            "title" -> p.copy(title = text)
                            "kind" -> p.copy(kind = text)
                            "leadDays" -> p.copy(leadDays = text)
                            else -> p
                        }
                    }
                },
        )
}
