package ch.orellbuehler.hauswart.platform

/**
 * What the server shows for this device under "devices" (`deviceName`, `platform` of the token),
 * and the language of the device ("de", "en", ...) for the screens before anyone is signed in.
 */
class DeviceInfo(
    val name: String,
    val platform: String,
    val language: String,
)
