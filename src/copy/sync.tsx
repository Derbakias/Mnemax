// The words in the Sync section: its info text, the pairing steps and notes, and the messages it shows. Change
// them here. (The sync log's lines stay where they're written, next to the Rust side's own.)

export const syncCopy = {
  section: {
    title: 'Sync',
    info: (
      <>
        <p>
          Swap rounds with your other devices on the same Wi-Fi: each gets the rounds the other is missing. Sync only
          adds rounds; it never changes or deletes them, and it never touches your settings.
        </p>
        <p>
          To connect two devices, tap <strong>Show a code</strong> on one (a computer is best, as it stays on) and{' '}
          <strong>Enter a code</strong> on the other, then scan the QR code or type the address and code. A code works
          once, for one minute.
        </p>
        <p>
          After that, the second device connects to the first by itself whenever Mnemax is open on both: when it opens,
          after each round, and every few minutes. On a phone, only while Mnemax is on the screen.
        </p>
        <p>
          If a device's address changes (after the router restarts, say), Sync can't reach it: tap{' '}
          <strong>Reconnect</strong> under the message and connect them again. Your rounds stay.
        </p>
        <p>
          <strong>Forget</strong> stops a device syncing with this one. Do it on both devices. Check this list now and
          then: a device you don't recognise has your rounds, so forget it.
        </p>
        <p>
          The first time, Windows asks whether Mnemax may use the network. Allow it on private networks only, not public
          ones, so nobody on a café or office Wi-Fi can reach it.
        </p>
      </>
    ),
    /** Above this device's name, and above the box to rename it. */
    thisDevice: 'This device',
    renameLabel: "This device's name (paired devices see it after your next sync with them)",
    pairedDevices: 'Paired devices',
    noPeers: 'No paired devices. Connect a device to sync with it.',
    autoSwitch: 'Sync automatically',
    // Under the switch: when paired devices can sync with this one.
    reachAuto: 'Syncs by itself while Mnemax is open on both devices.',
    reachListening: 'Paired devices can sync with this one while Settings is open.',
    reachClosed: 'Open Settings on both to sync.',
    /** Leads the message when something went wrong. */
    errorLead: 'Error:',
  },
  peer: {
    /** `day` and `when` are dates, like "2 Oct 2026" and "2 Oct 2026, 14:05". */
    pairedOn: (day: string) => `Paired ${day}`,
    lastSynced: (when: string) => `Last synced ${when}`,
    notSynced: 'Not synced yet',
    /** On the device that showed the code: the other one starts the syncs. */
    notSyncedWaits: 'Not synced yet. It connects to this device by itself.',
    forgot: (name: string) => `Forgot ${name} on this device. On ${name}, tap Forget too.`,
  },
  pairing: {
    // The steps when entering a code. The first one changes to name the device when reconnecting to it.
    stepShowCode: 'On your other device, open Sync and tap Show a code.',
    stepShowCodeOn: (name: string) => `On ${name}, open Sync and tap Show a code.`,
    stepScan: 'Scan the QR code it shows, or type its address and code and tap Pair.',
    ownCodeOnly: "Only use a code from your own device: a code from someone else's device would send them your rounds.",
    /** Between Scan QR code and the address and code boxes. */
    orType: 'or type what it shows',
    paired: (name: string) => `Paired with ${name}.`,
    /** Leads the error under the Pair button. */
    failedLead: "Didn't pair:",
    notACode: "That isn't a Mnemax pairing code. Scan the one under Show a code on your other device.",
    scanFailed: (error: string) => `Couldn't scan: ${error}`,
    // Over the camera while it looks for the code: on a phone, then on a computer.
    phoneScanHint: 'Point the camera at the QR code on your other device',
    cameraScanHint: 'Hold the QR code on your other device up to the camera',
  },
  showCode: {
    stepEnterCode: 'On your other device, open Sync and tap Enter a code.',
    stepScan: 'Scan this QR code with it, or type the address and code below.',
    /** `seconds` left before the code stops working. */
    timeLeft: (seconds: number) => `Works once, for ${seconds} more second${seconds === 1 ? '' : 's'}.`,
    ranOut: 'The code ran out.',
    /** Under why the code can't be used any more. */
    whyShort: 'A code works once, for one minute, so nobody else has time to guess it.',
  },
  /** Why the camera didn't open or couldn't scan. */
  camera: {
    cantOpen: "This device can't open its camera here.",
    cantRead: "Couldn't read the camera picture.",
    notAllowed: "Mnemax isn't allowed to use the camera. Allow it in the system's settings, or type the code.",
    notFound: 'No camera found.',
    busy: 'The camera is busy: another app may be using it.',
    phoneNotAllowed: "Mnemax needs the camera to scan the code. Allow it in the phone's settings, or type the code.",
  },
  messages: {
    /** After a sync, under the device. `n` is a number of rounds. */
    synced: (n: number) => `Synced ${n} new round${n === 1 ? '' : 's'}.`,
    nothingNew: 'Synced, nothing new.',
    skipped: (n: number) => `Skipped ${n} broken round${n === 1 ? '' : 's'}.`,
    /** `name` is the device that sent them; `error` says what went wrong. */
    saveFailed: (name: string, error: string) => `Couldn't save the rounds from ${name}: ${error}`,
    outOfDate: 'Sync is out of date. Restart or update the app.',
    unknownAnswer: "The app's sync answered in a way this page doesn't know. Restart the app.",
    /** When an error has no message of its own. */
    somethingWrong: 'Something went wrong.',
  },
};
