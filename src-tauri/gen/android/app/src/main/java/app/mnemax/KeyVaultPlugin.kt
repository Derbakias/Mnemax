package app.mnemax

import android.app.Activity
import android.os.Build
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import app.tauri.annotation.Command
import app.tauri.annotation.InvokeArg
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Invoke
import app.tauri.plugin.JSObject
import app.tauri.plugin.Plugin
import java.security.KeyStore
import javax.crypto.AEADBadTagException
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

@InvokeArg
class SealArgs {
  /** In hex, like everything that comes and goes here. */
  lateinit var data: String
  /** Mixed into the seal, so a sealed value can't be passed off as anything else. */
  lateinit var purpose: String
}

// Seals sync's private key with an AES key that lives in the Android Keystore (in the phone's secure
// hardware where it has one): no app can read that key out, and it isn't backed up or moved to a new phone,
// so the sealed key in sync.json only opens on this phone (see src/sync/vault.rs).
@TauriPlugin
class KeyVaultPlugin(private val activity: Activity) : Plugin(activity) {
  private val alias = "mnemax-sync"

  @Command
  fun seal(invoke: Invoke) {
    val args = invoke.parseArgs(SealArgs::class.java)
    try {
      val cipher = Cipher.getInstance(TRANSFORMATION)
      cipher.init(Cipher.ENCRYPT_MODE, key() ?: newKey())
      cipher.updateAAD(args.purpose.fromHex())
      val sealed = cipher.iv + cipher.doFinal(args.data.fromHex())
      invoke.resolve(JSObject().apply { put("data", sealed.toHex()) })
    } catch (e: Exception) {
      invoke.reject("Couldn't seal the key: $e", "unavailable")
    }
  }

  @Command
  fun open(invoke: Invoke) {
    val args = invoke.parseArgs(SealArgs::class.java)
    val sealed = args.data.fromHex()
    val key = try {
      key()
    } catch (e: Exception) {
      invoke.reject("Couldn't reach the Keystore: $e", "unavailable")
      return
    }
    if (key == null || sealed.size <= IV_BYTES) {
      invoke.reject("The key that sealed it is gone", "lost")
      return
    }
    try {
      val cipher = Cipher.getInstance(TRANSFORMATION)
      cipher.init(Cipher.DECRYPT_MODE, key, GCMParameterSpec(TAG_BITS, sealed, 0, IV_BYTES))
      cipher.updateAAD(args.purpose.fromHex())
      val secret = cipher.doFinal(sealed, IV_BYTES, sealed.size - IV_BYTES)
      invoke.resolve(JSObject().apply { put("data", secret.toHex()) })
      secret.fill(0)
    } catch (e: AEADBadTagException) {
      invoke.reject("It doesn't open with this phone's key", "lost")
    } catch (e: Exception) {
      invoke.reject("Couldn't open the key: $e", "unavailable")
    }
  }

  private fun key(): SecretKey? {
    val store = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
    return store.getKey(alias, null) as SecretKey?
  }

  // In the secure hardware (StrongBox) where the phone has it, else in the Keystore's usual trusted
  // environment.
  private fun newKey(): SecretKey {
    fun generate(strongBox: Boolean): SecretKey {
      val spec = KeyGenParameterSpec.Builder(alias, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
        .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
        .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
        .setKeySize(256)
        .apply { if (strongBox && Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) setIsStrongBoxBacked(true) }
        .build()
      return KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore").run {
        init(spec)
        generateKey()
      }
    }
    return try {
      generate(strongBox = true)
    } catch (e: Exception) {
      // No StrongBox (not every phone reports that the same way).
      generate(strongBox = false)
    }
  }

  private companion object {
    const val TRANSFORMATION = "AES/GCM/NoPadding"
    const val IV_BYTES = 12
    const val TAG_BITS = 128
  }
}

private fun ByteArray.toHex(): String = joinToString("") { "%02x".format(it) }

private fun String.fromHex(): ByteArray {
  require(length % 2 == 0) { "odd hex" }
  return ByteArray(length / 2) { i -> substring(i * 2, i * 2 + 2).toInt(16).toByte() }
}
