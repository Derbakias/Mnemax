// How syncing with your other devices behaves: timings, which failures are shown, and limits.

// Syncing by itself

/** How often the app syncs by itself while it's open. */
export const AUTO_SYNC_MS = 3 * 60 * 1000;
/** After the app opens or a round is played, a short wait before syncing, so the app isn't slowed down. */
export const AUTO_SYNC_DELAY_MS = 1500;

// Results and failures

/** How long a sync result stays under its device. An error stays until the next try. */
export const RESULT_SHOWN_MS = 30_000;
/** Failures an automatic sync shows. The rest (like the other device not being open) only go in the log. */
export const AUTO_FAILURES_SHOWN = ['storage', 'keyStore'];
/** Failures where pairing again may help: its address changed, or it forgot this device. */
export const RECONNECT_FAILURES = ['unreachable', 'refused'];
/**
 * Failures an automatic sync shows under the device: trying again won't help, the person has to do something (pair
 * again, or update the app). Other ones, like the device not being open, only go in the log.
 */
export const AUTO_PEER_FAILURES = ['refused'];

// Pairing

/** After pressing Pair, how long until it can be pressed again, even when the answer comes back at once. */
export const RETRY_AFTER_MS = 1000;
/** How often the camera picture is checked for a QR code. */
export const LOOK_EVERY_MS = 150;
/** Pictures are made this wide (at most) before looking for the code: big enough to read it, quick to check. */
export const LOOK_WIDTH = 640;
/** How long "Tap again" waits for the second tap when forgetting a device. */
export const FORGET_CONFIRM_MS = 3000;

// Log

/** The log keeps this many steps, the latest. */
export const MAX_LOG_LINES = 300;

// Talking to the Rust side

/**
 * The version of the Rust commands this page talks to: must match API_VERSION in src-tauri/src/sync/commands.rs.
 * During development this page reloads by itself but Rust only when the app is rebuilt.
 */
export const SYNC_API = 5;
