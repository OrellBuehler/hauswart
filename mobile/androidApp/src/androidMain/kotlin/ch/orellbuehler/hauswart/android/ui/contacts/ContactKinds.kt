package ch.orellbuehler.hauswart.android.ui.contacts

import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Apartment
import androidx.compose.material.icons.outlined.Bolt
import androidx.compose.material.icons.outlined.Build
import androidx.compose.material.icons.outlined.Contacts
import androidx.compose.material.icons.outlined.Emergency
import androidx.compose.material.icons.outlined.Home
import androidx.compose.material.icons.outlined.Shield
import androidx.compose.material.icons.outlined.ShoppingCart
import androidx.compose.material.icons.outlined.SupportAgent
import androidx.compose.ui.graphics.vector.ImageVector

internal fun contactKindIcon(kind: String): ImageVector =
    when (kind) {
        "installer" -> Icons.Outlined.Build
        "property_mgmt" -> Icons.Outlined.Apartment
        "manufacturer_support" -> Icons.Outlined.SupportAgent
        "emergency" -> Icons.Outlined.Emergency
        "utility" -> Icons.Outlined.Bolt
        "insurance" -> Icons.Outlined.Shield
        "neighbor" -> Icons.Outlined.Home
        "seller" -> Icons.Outlined.ShoppingCart
        else -> Icons.Outlined.Contacts
    }
