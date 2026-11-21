package ch.orellbuehler.hauswart.android

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import ch.orellbuehler.hauswart.android.ui.HauswartRoot

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        val app = (application as HauswartApplication).app
        setContent { HauswartRoot(app) }
    }
}
