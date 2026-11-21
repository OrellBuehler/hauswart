package ch.orellbuehler.hauswart.feature.search

import ch.orellbuehler.hauswart.feature.applink.AppLink
import ch.orellbuehler.hauswart.feature.applink.LINK_ASSET
import ch.orellbuehler.hauswart.feature.applink.LINK_DOC
import ch.orellbuehler.hauswart.feature.applink.LINK_TASK
import ch.orellbuehler.hauswart.i18n.tr
import ch.orellbuehler.hauswart.testing.TestApp
import ch.orellbuehler.hauswart.testing.await
import io.ktor.http.HttpStatusCode
import kotlinx.coroutines.test.runTest
import kotlin.test.AfterTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull
import kotlin.test.assertTrue

class SearchStoreTest {
    private val server = TestApp().also { it.signIn() }
    private val app = server.app

    @AfterTest
    fun tearDown() = server.close()

    private fun hit(
        type: String,
        id: String,
        title: String,
        url: String,
        snippet: String = "",
    ) = """{"type":"$type","id":"$id","title":"$title","snippet":"$snippet","url":"$url"}"""

    private fun result(vararg hits: String) = """{"items":[${hits.joinToString(",")}]}"""

    private val boiler = hit("asset", "a1", "Boiler", "/assets/a1", "Heating in the cellar")
    private val filter = hit("task", "t1", "Change filter", "/tasks/t1")
    private val manual = hit("page", "p1", "Boiler manual", "/docs/boiler-manual")
    private val hintHit = hit("asset_hint", "h1", "Boiler tip", "/assets/a1")

    @Test
    fun startsIdle() =
        runTest {
            val store = SearchStore(app)
            val state = store.value
            assertTrue(state.idle)
            assertTrue(!state.empty)
            assertTrue(server.requests.isEmpty())
            store.close()
        }

    @Test
    fun groupsHitsByKindInTheOrderOfTheWeb() =
        runTest {
            server.on("GET", "/api/v1/search", result(filter, boiler, hintHit, manual))
            val store = SearchStore(app)
            store.setQuery("boiler")
            val state = store.await { it.groups.isNotEmpty() }
            assertEquals(listOf("page", "asset", "task", "asset_hint"), state.groups.map { it.type })
            assertEquals(
                listOf(
                    tr("search_type_page"),
                    tr("search_type_asset"),
                    tr("search_type_task"),
                    tr("search_type_hint"),
                ),
                state.groups.map {
                    it.title
                },
            )
            assertEquals(
                AppLink(LINK_ASSET, "a1"),
                state.groups[1]
                    .hits
                    .single()
                    .link,
            )
            assertEquals(
                AppLink(LINK_DOC, "boiler-manual"),
                state.groups[0]
                    .hits
                    .single()
                    .link,
            )
            assertEquals(
                "Heating in the cellar",
                state.groups[1]
                    .hits
                    .single()
                    .snippet,
            )
            assertEquals(4, state.total)
            assertEquals(4, state.shown)
            assertEquals(listOf("", "page", "asset", "task", "asset_hint"), state.filters.map { it.type })
            assertEquals(listOf(4, 1, 1, 1, 1), state.filters.map { it.count })
            val query = server.requests.single { it.path == "/api/v1/search" }.query
            assertTrue("q=boiler" in query && "limit=50" in query)
            store.close()
        }

    @Test
    fun theKindFilterNarrowsTheGroupsAndFallsBackWhenItHasNoHits() =
        runTest {
            server.on("GET", "/api/v1/search", result(filter, boiler))
            val store = SearchStore(app)
            store.setQuery("x")
            store.await { it.groups.isNotEmpty() }
            store.setType("task")
            val state = store.await { it.type == "task" }
            assertEquals(listOf("task"), state.groups.map { it.type })
            assertEquals(1, state.shown)
            assertEquals(2, state.total)

            server.on("GET", "/api/v1/search", result(boiler))
            store.setQuery("xy")
            val after = store.await { it.query == "xy" && !it.loading && it.total == 1 }
            assertEquals("", after.type)
            assertTrue(after.filters.isEmpty())
            store.close()
        }

    @Test
    fun noHitsIsEmptyNotIdle() =
        runTest {
            server.on("GET", "/api/v1/search", result())
            val store = SearchStore(app)
            store.setQuery("nothing")
            val state = store.await { it.empty }
            assertTrue(!state.idle)
            store.close()
        }

    @Test
    fun clearingTheFieldGoesBackToIdleWithoutAsking() =
        runTest {
            server.on("GET", "/api/v1/search", result(boiler))
            val store = SearchStore(app)
            store.setQuery("boiler")
            store.await { it.groups.isNotEmpty() }
            store.setQuery("   ")
            val state = store.await { it.idle }
            assertTrue(state.groups.isEmpty())
            assertEquals(1, server.requestsTo("GET", "/api/v1/search").size)
            store.close()
        }

    @Test
    fun typingFastAsksOnlyForTheLastWord() =
        runTest {
            server.on("GET", "/api/v1/search", result(boiler))
            val store = SearchStore(app)
            store.setQuery("b")
            store.setQuery("bo")
            store.setQuery("boi")
            store.await { it.groups.isNotEmpty() }
            val asked = server.requestsTo("GET", "/api/v1/search")
            assertEquals(1, asked.size)
            assertTrue("q=boi" in asked.single().query)
            store.close()
        }

    @Test
    fun theQueryIsCutAtOneHundredCharacters() =
        runTest {
            server.on("GET", "/api/v1/search", result())
            val store = SearchStore(app)
            store.setQuery("a".repeat(150))
            store.await { it.empty }
            assertTrue("q=${"a".repeat(100)}&" in server.requests.single { it.path == "/api/v1/search" }.query + "&")
            store.close()
        }

    @Test
    fun hitsWithForeignAddressesAreDropped() =
        runTest {
            server.on(
                "GET",
                "/api/v1/search",
                result(boiler, hit("asset", "a2", "Evil", "//evil.example.org/x"), hit("asset", "a3", "Evil2", "https://evil.example.org")),
            )
            val store = SearchStore(app)
            store.setQuery("e")
            val state = store.await { it.groups.isNotEmpty() }
            assertEquals(1, state.total)
            store.close()
        }

    @Test
    fun hitsOfAnUnknownPlaceHaveNoLink() =
        runTest {
            server.on("GET", "/api/v1/search", result(hit("document", "paperless:5", "Invoice", "/somewhere/else")))
            val store = SearchStore(app)
            store.setQuery("inv")
            val state = store.await { it.groups.isNotEmpty() }
            assertNull(
                state.groups
                    .single()
                    .hits
                    .single()
                    .link,
            )
            assertEquals(
                "document:paperless:5",
                state.groups
                    .single()
                    .hits
                    .single()
                    .key,
            )
            store.close()
        }

    @Test
    fun aFailedSearchSetsTheErrorAndRetryRecovers() =
        runTest {
            server.onError("GET", "/api/v1/search", HttpStatusCode.InternalServerError, "internal_error")
            val store = SearchStore(app)
            store.setQuery("boiler")
            val failed = store.await { it.error != null }
            assertEquals(tr("m_error_server"), failed.error?.message)
            assertTrue(!failed.loading && !failed.empty)

            server.on("GET", "/api/v1/search", result(filter))
            store.retry()
            val state = store.await { it.groups.isNotEmpty() }
            assertNull(state.error)
            assertEquals(
                AppLink(LINK_TASK, "t1"),
                state.groups
                    .single()
                    .hits
                    .single()
                    .link,
            )
            store.close()
        }
}
