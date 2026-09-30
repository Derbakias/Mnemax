package app.mnemax

import android.app.Activity
import android.content.Context
import android.net.wifi.WifiManager
import app.tauri.annotation.Command
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Invoke
import app.tauri.plugin.Plugin

// Android drops the multicast packets mDNS uses unless an app holds a multicast lock. Sync holds it only
// while it announces this device or looks for another one (see `multicast` in src/sync/mod.rs).
@TauriPlugin
class MulticastPlugin(private val activity: Activity) : Plugin(activity) {
  private val lock: WifiManager.MulticastLock by lazy {
    val wifi = activity.applicationContext.getSystemService(Context.WIFI_SERVICE) as WifiManager
    // Counted, so a pairing and a sync can each hold it and let go on their own.
    wifi.createMulticastLock("mnemax-sync").apply { setReferenceCounted(true) }
  }

  @Command
  fun acquire(invoke: Invoke) {
    lock.acquire()
    invoke.resolve()
  }

  @Command
  fun release(invoke: Invoke) {
    if (lock.isHeld) lock.release()
    invoke.resolve()
  }
}
