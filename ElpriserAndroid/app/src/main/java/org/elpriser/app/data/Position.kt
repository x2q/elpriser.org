package org.elpriser.app.data

import android.Manifest
import android.annotation.SuppressLint
import android.content.Context
import android.content.pm.PackageManager
import android.location.Location
import android.location.LocationManager
import androidx.core.content.ContextCompat
import androidx.core.location.LocationManagerCompat
import androidx.core.os.CancellationSignal
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlin.coroutines.resume

/** Henter positionen én gang, når brugeren trykker. Intet kører i baggrunden, og intet gemmes. */
object Position {
    fun hasPermission(c: Context): Boolean =
        ContextCompat.checkSelfPermission(c, Manifest.permission.ACCESS_COARSE_LOCATION) == PackageManager.PERMISSION_GRANTED ||
            ContextCompat.checkSelfPermission(c, Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED

    @SuppressLint("MissingPermission")
    suspend fun current(c: Context): Location? {
        if (!hasPermission(c)) return null
        val lm = c.getSystemService(Context.LOCATION_SERVICE) as LocationManager
        val providers = listOf(LocationManager.NETWORK_PROVIDER, LocationManager.GPS_PROVIDER, LocationManager.PASSIVE_PROVIDER)
            .filter { runCatching { lm.isProviderEnabled(it) }.getOrDefault(false) }
        for (p in providers) {
            val fix = suspendCancellableCoroutine<Location?> { cont ->
                val cancel = CancellationSignal()
                cont.invokeOnCancellation { cancel.cancel() }
                val timer = android.os.Handler(android.os.Looper.getMainLooper())
                val timeout = Runnable { cancel.cancel() }
                timer.postDelayed(timeout, 8_000)
                LocationManagerCompat.getCurrentLocation(lm, p, cancel, ContextCompat.getMainExecutor(c)) { loc ->
                    timer.removeCallbacks(timeout)
                    if (cont.isActive) cont.resume(loc)
                }
            }
            if (fix != null) return fix
            runCatching { lm.getLastKnownLocation(p) }.getOrNull()?.let { return it }
        }
        return null
    }
}
