package ch.orellbuehler.hauswart.feature.contacts

/** The address behind a "call" button: digits and a leading plus, as the dialer wants them. */
fun telUri(phone: String): String = "tel:" + phone.filterIndexed { i, c -> c.isDigit() || (c == '+' && i == 0) }

fun mailUri(email: String): String = "mailto:" + email.trim()

/** A search for [address] in the maps app. */
fun mapUri(address: String): String = "geo:0,0?q=" + address.replace('\n', ',').trim().encodeUriComponent()

private fun String.encodeUriComponent(): String =
    buildString {
        for (b in encodeToByteArray()) {
            val c = b.toInt() and 0xFF
            val ch = c.toChar()
            if (c < 0x80 && (ch.isLetterOrDigit() || ch in "-_.~")) {
                append(ch)
            } else {
                append('%').append("0123456789ABCDEF"[c shr 4]).append("0123456789ABCDEF"[c and 0xF])
            }
        }
    }
