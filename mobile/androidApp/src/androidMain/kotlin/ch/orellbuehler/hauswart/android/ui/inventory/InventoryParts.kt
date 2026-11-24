package ch.orellbuehler.hauswart.android.ui.inventory

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Add
import androidx.compose.material.icons.outlined.Archive
import androidx.compose.material.icons.outlined.Bathtub
import androidx.compose.material.icons.outlined.Bed
import androidx.compose.material.icons.outlined.Build
import androidx.compose.material.icons.outlined.Category
import androidx.compose.material.icons.outlined.Chair
import androidx.compose.material.icons.outlined.Checkroom
import androidx.compose.material.icons.outlined.ChildCare
import androidx.compose.material.icons.outlined.Computer
import androidx.compose.material.icons.outlined.DirectionsCar
import androidx.compose.material.icons.outlined.DoorFront
import androidx.compose.material.icons.outlined.FitnessCenter
import androidx.compose.material.icons.outlined.Hardware
import androidx.compose.material.icons.outlined.Home
import androidx.compose.material.icons.outlined.Inventory2
import androidx.compose.material.icons.outlined.KingBed
import androidx.compose.material.icons.outlined.Kitchen
import androidx.compose.material.icons.outlined.LocalFlorist
import androidx.compose.material.icons.outlined.LocalLaundryService
import androidx.compose.material.icons.outlined.MeetingRoom
import androidx.compose.material.icons.outlined.Memory
import androidx.compose.material.icons.outlined.MenuBook
import androidx.compose.material.icons.outlined.Park
import androidx.compose.material.icons.outlined.Shield
import androidx.compose.material.icons.outlined.Shower
import androidx.compose.material.icons.outlined.SportsEsports
import androidx.compose.material.icons.outlined.Tv
import androidx.compose.material.icons.outlined.Warehouse
import androidx.compose.material.icons.outlined.Warning
import androidx.compose.material.icons.outlined.Wc
import androidx.compose.material.icons.outlined.Weekend
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.SnackbarDuration
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.SnackbarResult
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import ch.orellbuehler.hauswart.android.ui.components.ListRow
import ch.orellbuehler.hauswart.android.ui.components.RowIcon
import ch.orellbuehler.hauswart.android.ui.components.ScreenPadding
import ch.orellbuehler.hauswart.android.ui.components.SectionCard
import ch.orellbuehler.hauswart.android.ui.components.StatusChip
import ch.orellbuehler.hauswart.core.UiError
import ch.orellbuehler.hauswart.feature.inventory.AssetRow
import ch.orellbuehler.hauswart.feature.inventory.InventoryChoice
import ch.orellbuehler.hauswart.feature.inventory.InventoryNotice
import ch.orellbuehler.hauswart.feature.inventory.TaskLine
import ch.orellbuehler.hauswart.i18n.tr

internal fun assetKindIcon(kind: String): ImageVector =
    when (kind) {
        "device" -> Icons.Outlined.Memory
        "plant" -> Icons.Outlined.Park
        "fixture" -> Icons.Outlined.DoorFront
        "vehicle" -> Icons.Outlined.DirectionsCar
        else -> Icons.Outlined.Category
    }

internal fun hintKindIcon(kind: String): ImageVector =
    when (kind) {
        "warning" -> Icons.Outlined.Warning
        "rule" -> Icons.Outlined.Shield
        else -> Icons.Outlined.Build
    }

internal fun List<InventoryChoice>.pairs(): List<Pair<String, String>> = map { it.value to it.label }

/** Shows [notice] as a snackbar; its action undoes or opens the defect, whichever the notice offers. */
@Composable
internal fun NoticeEffect(
    notice: InventoryNotice?,
    snackbar: SnackbarHostState,
    onDismiss: () -> Unit,
    onUndo: (() -> Unit)? = null,
    onOpenDefect: ((String) -> Unit)? = null,
) {
    val undoLabel = tr("common_undo")
    val defectLabel = tr("asset_notes_open_defect")
    LaunchedEffect(notice) {
        if (notice != null) {
            val label =
                when {
                    notice.undo && onUndo != null -> undoLabel
                    notice.defectId != null && onOpenDefect != null -> defectLabel
                    else -> null
                }
            val result = snackbar.showSnackbar(notice.message, label, duration = SnackbarDuration.Long)
            if (result == SnackbarResult.ActionPerformed) {
                if (notice.undo) onUndo?.invoke()
                notice.defectId?.let { onOpenDefect?.invoke(it) }
            }
            onDismiss()
        }
    }
}

/** Shows a failed action as a snackbar. */
@Composable
internal fun ErrorEffect(
    error: UiError?,
    snackbar: SnackbarHostState,
    onDismiss: () -> Unit,
) {
    LaunchedEffect(error) {
        if (error != null) {
            snackbar.showSnackbar(error.message)
            onDismiss()
        }
    }
}

/** A dialog with a form: [content] scrolls, the save button shows a spinner while [pending]. */
@Composable
internal fun FormDialog(
    title: String,
    onDismiss: () -> Unit,
    onSave: () -> Unit,
    pending: Boolean,
    saveLabel: String = tr("common_save"),
    content: @Composable () -> Unit,
) {
    AlertDialog(
        onDismissRequest = { if (!pending) onDismiss() },
        title = { Text(title, maxLines = 2, overflow = TextOverflow.Ellipsis) },
        text = {
            Column(Modifier.verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                content()
            }
        },
        confirmButton = {
            Button(onClick = onSave, enabled = !pending) {
                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    if (pending) CircularProgressIndicator(Modifier.padding(0.dp), strokeWidth = 2.dp)
                    Text(if (pending) tr("common_saving") else saveLabel, maxLines = 1)
                }
            }
        },
        dismissButton = { TextButton(onClick = onDismiss, enabled = !pending) { Text(tr("common_cancel"), maxLines = 1) } },
    )
}

/** An asset as one row of a list; opens through [onClick]. */
@Composable
internal fun AssetListRow(
    row: AssetRow,
    onClick: () -> Unit,
) {
    ListRow(
        title = row.name,
        subtitle = row.subtitle,
        leading = { RowIcon(assetKindIcon(row.kind)) },
        trailing =
            if (row.archived) {
                { StatusChip(tr("asset_archived"), icon = Icons.Outlined.Archive) }
            } else {
                row.warranty?.let { w -> { StatusChip(w.label, tone = w.tone) } }
            },
        onClick = onClick,
    )
}

/** A task as one row; the status and the date show on the right. */
@Composable
internal fun TaskLineRow(
    line: TaskLine,
    showAsset: Boolean = false,
    onClick: () -> Unit,
) {
    ListRow(
        title = line.title,
        subtitle = if (showAsset) line.assetName else line.dateText,
        trailing = { StatusChip(line.statusLabel, tone = line.tone) },
        onClick = onClick,
    )
}

/** A card with a title, an add button on the right and its content: the frame of the sections of an asset. */
@Composable
internal fun AddSection(
    title: String,
    addLabel: String,
    onAdd: () -> Unit,
    content: @Composable () -> Unit,
) {
    SectionCard {
        Row(
            Modifier.padding(start = ScreenPadding, end = 8.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Text(
                title,
                Modifier.weight(1f),
                style = MaterialTheme.typography.titleSmall,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
            OutlinedButton(onClick = onAdd) {
                Icon(Icons.Outlined.Add, contentDescription = null)
                Text(addLabel, maxLines = 1)
            }
        }
        content()
    }
}

internal fun roomIconVector(name: String?): ImageVector =
    when (name) {
        "cooking-pot" -> Icons.Outlined.Kitchen
        "bath" -> Icons.Outlined.Bathtub
        "shower-head" -> Icons.Outlined.Shower
        "toilet" -> Icons.Outlined.Wc
        "sofa" -> Icons.Outlined.Weekend
        "armchair" -> Icons.Outlined.Chair
        "bed" -> Icons.Outlined.Bed
        "bed-double" -> Icons.Outlined.KingBed
        "baby" -> Icons.Outlined.ChildCare
        "tv" -> Icons.Outlined.Tv
        "monitor" -> Icons.Outlined.Computer
        "book-open" -> Icons.Outlined.MenuBook
        "shirt" -> Icons.Outlined.Checkroom
        "washing-machine" -> Icons.Outlined.LocalLaundryService
        "warehouse" -> Icons.Outlined.Warehouse
        "archive" -> Icons.Outlined.Inventory2
        "flower-2" -> Icons.Outlined.LocalFlorist
        "trees" -> Icons.Outlined.Park
        "car" -> Icons.Outlined.DirectionsCar
        "hammer" -> Icons.Outlined.Hardware
        "dumbbell" -> Icons.Outlined.FitnessCenter
        "gamepad-2" -> Icons.Outlined.SportsEsports
        "house" -> Icons.Outlined.Home
        else -> Icons.Outlined.MeetingRoom
    }
