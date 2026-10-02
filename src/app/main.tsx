import React from 'react';
import ReactDOM from 'react-dom/client';

import App from './App';
import { useSettingsStore } from '@/stores/settings';
import { useSyncStore } from '@/stores/sync';
import { syncAvailable } from '@/sync/sync';
import { startSyncDriver } from '@/sync/sync-auto';
import '../styles/index.css';

// Start reading the saved settings now; the startup screen waits until they are in.
useSettingsStore.getState().load();
// Sync runs app-wide (only in the app): it listens and syncs by itself while the app is open, never during a round.
if (syncAvailable()) {
  useSyncStore.getState().refresh();
  startSyncDriver();
}

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
