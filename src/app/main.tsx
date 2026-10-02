import React from 'react';
import ReactDOM from 'react-dom/client';

import App from './App';
import { useSettingsStore } from '@/stores/settings';
import '../styles/index.css';

// Start reading the saved settings now; the startup screen waits until they are in.
useSettingsStore.getState().load();

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
