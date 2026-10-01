import { isTauri } from '@tauri-apps/api/core';
import type { Store } from '@tauri-apps/plugin-store';

import { STORE_FILE } from '@/config/storage';

// Key-value persistence: a JSON file in the app data dir under Tauri,
// localStorage when running in a plain browser (vite dev).

const storePromises = new Map<string, Promise<Store>>();

// Every write saves the whole file, so data written often (like the round in progress) goes in a small
// file of its own rather than next to the saved rounds.
function tauriStore(file: string): Promise<Store> {
  let promise = storePromises.get(file);
  if (!promise) {
    promise = import('@tauri-apps/plugin-store').then(({ load }) => load(file, { autoSave: false, defaults: {} }));
    storePromises.set(file, promise);
  }
  return promise;
}

export async function getItem(key: string, file = STORE_FILE): Promise<string | null> {
  if (isTauri()) {
    const value = await (await tauriStore(file)).get<string>(key);
    return typeof value === 'string' ? value : null;
  }
  return localStorage.getItem(key);
}

export async function setItem(key: string, value: string, file = STORE_FILE): Promise<void> {
  if (isTauri()) {
    const store = await tauriStore(file);
    await store.set(key, value);
    await store.save();
    return;
  }
  localStorage.setItem(key, value);
}

export async function removeItem(key: string, file = STORE_FILE): Promise<void> {
  if (isTauri()) {
    const store = await tauriStore(file);
    await store.delete(key);
    await store.save();
    return;
  }
  localStorage.removeItem(key);
}
