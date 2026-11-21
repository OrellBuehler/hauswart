package ch.orellbuehler.hauswart.feature

import ch.orellbuehler.hauswart.feature.connect.normalizeServerUrl
import kotlin.test.Test
import kotlin.test.assertEquals

class ServerUrlTest {
    @Test
    fun normalizesWhatPeopleType() {
        val cases =
            listOf(
                "home.example.org" to "https://home.example.org",
                " https://Home.Example.org/ " to "https://home.example.org",
                "https://home.example.org/tasks?x=1" to "https://home.example.org",
                "http://home.example.org:3000/" to "http://home.example.org:3000",
                "192.168.1.20:3000" to "http://192.168.1.20:3000",
                "hauswart:3000" to "http://hauswart:3000",
                "nas.local" to "http://nas.local",
                "localhost:3000" to "http://localhost:3000",
                "" to null,
                "home example" to null,
                "ftp://home.example.org" to null,
                "https://" to null,
                "https://user@home.example.org" to null,
                "home.example.org:port" to null,
            )
        for ((input, expected) in cases) assertEquals(expected, normalizeServerUrl(input), input)
    }
}
