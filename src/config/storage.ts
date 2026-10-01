// Where the app saves its data on the device.
// Never change these names: saved data is found by them, so a new name would lose everything saved so far.

/** The main save file (under Tauri; in a plain browser everything goes to localStorage). */
export const STORE_FILE = 'mnemax.json';
export const SETTINGS_KEY = 'mnemax.settings.v1';
export const PREFS_KEY = 'mnemax.prefs.v1';
export const ROUNDS_KEY = 'mnemax.rounds.v1';
/** The round being played, saved after every trial, in a small file of its own. */
export const ROUND_IN_PROGRESS_KEY = 'mnemax.round-in-progress.v1';
export const ROUND_IN_PROGRESS_FILE = 'round-in-progress.json';

/** The most rounds kept: the oldest are dropped past this. */
export const MAX_ROUNDS = 500;
