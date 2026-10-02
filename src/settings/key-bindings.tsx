import { useEffect, useState } from 'react';

import { Icon } from '@/components/ui/icon';
import { settingsCopy } from '@/copy/settings';
import { STREAM_ICONS } from '@/config/ui';
import type { StreamId } from '@/game/types';
import { STREAM_IDS, STREAM_LABELS } from '@/game/types';
import { isBindableKey, keyLabel } from '@/lib/prefs';

/**
 * One row per stream with its answer key. Tapping a key waits for the next key press and assigns it
 * (Esc cancels); a key already used by another stream swaps with it.
 */
export function KeyBindings({
  keys,
  onChange,
}: {
  keys: Record<StreamId, string>;
  onChange: (stream: StreamId, key: string) => void;
}) {
  const [listening, setListening] = useState<StreamId | null>(null);
  const [warning, setWarning] = useState<string | null>(null);

  useEffect(() => {
    if (!listening) {
      return;
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey) {
        return;
      }
      if (['Shift', 'CapsLock', 'Tab'].includes(e.key)) {
        return;
      }
      e.preventDefault();
      e.stopPropagation();
      if (e.key === 'Escape') {
        setListening(null);
        setWarning(null);
      } else if (e.key === ' ') {
        setWarning(settingsCopy.keyboard.spaceTaken);
      } else if (!isBindableKey(e.key)) {
        setWarning(settingsCopy.keyboard.keyNotAllowed(e.key));
      } else {
        onChange(listening, e.key);
        setListening(null);
        setWarning(null);
      }
    };
    window.addEventListener('keydown', onKey, { capture: true });
    return () => window.removeEventListener('keydown', onKey, { capture: true });
  }, [listening, onChange]);

  return (
    <div className="stack-8">
      {STREAM_IDS.map((stream) => (
        <div key={stream} className="row-between">
          <span className="key-binding-label t-default">
            <Icon name={STREAM_ICONS[stream]} size={20} />
            {STREAM_LABELS[stream]}
          </span>
          <button
            type="button"
            className={listening === stream ? 'key-binding listening' : 'key-binding'}
            aria-label={`${STREAM_LABELS[stream]} key: ${keyLabel(keys[stream])}. Tap to change.`}
            onClick={() => {
              setListening(listening === stream ? null : stream);
              setWarning(null);
            }}
          >
            {listening === stream ? 'Press a key…' : keyLabel(keys[stream])}
          </button>
        </div>
      ))}
      {warning && <p className="t-small bad">{warning}</p>}
    </div>
  );
}
