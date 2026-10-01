import { useEffect, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

import { syncCopy } from '@/copy/sync';
import { LOOK_EVERY_MS, LOOK_WIDTH } from '@/config/sync';

/**
 * While the camera looks for the QR code: a frame to aim with and Cancel. On a phone the camera shows behind the
 * page, so the page hides everything else; on a computer `children` is the camera picture.
 */
export function ScanOverlay({
  hint,
  onCancel,
  children,
}: {
  hint: string;
  onCancel: () => void;
  children?: ReactNode;
}) {
  useEffect(() => {
    document.documentElement.classList.add('scanning');
    return () => document.documentElement.classList.remove('scanning');
  }, []);
  return createPortal(
    <div className="scan-overlay">
      {children}
      <p className="scan-hint">{hint}</p>
      <div className="scan-frame" aria-hidden />
      <button type="button" className="outline-button scan-cancel" onClick={onCancel}>
        Cancel
      </button>
    </div>,
    document.body,
  );
}

/**
 * Scanning on a computer: the page opens the camera itself and looks for a QR code in its picture, until it
 * finds one (`onFound`), Cancel is pressed, or the camera can't be opened (`onFail`). The camera turns off when
 * this closes.
 */
export function CameraScan({
  onFound,
  onCancel,
  onFail,
}: {
  onFound: (text: string) => void;
  onCancel: () => void;
  onFail: (error: unknown) => void;
}) {
  const video = useRef<HTMLVideoElement>(null);
  const handlers = useRef({ onFound, onFail });
  handlers.current = { onFound, onFail };

  useEffect(() => {
    let closed = false;
    let stream: MediaStream | null = null;
    let timer: ReturnType<typeof setInterval> | undefined;
    const close = () => {
      closed = true;
      clearInterval(timer);
      stream?.getTracks().forEach((track) => track.stop());
    };

    void (async () => {
      try {
        if (!navigator.mediaDevices?.getUserMedia) {
          throw new Error(syncCopy.camera.cantOpen);
        }
        // The QR reader first: if it can't load, the camera is never turned on.
        const { default: jsQR } = await import('jsqr');
        if (closed) {
          return;
        }
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: false });
        const view = video.current;
        if (closed || !view) {
          return close();
        }
        view.srcObject = stream;
        await view.play();

        const canvas = document.createElement('canvas');
        const context = canvas.getContext('2d', { willReadFrequently: true });
        if (!context) {
          throw new Error(syncCopy.camera.cantRead);
        }
        timer = setInterval(() => {
          if (closed || view.readyState < view.HAVE_CURRENT_DATA || view.videoWidth === 0) {
            return;
          }
          const scale = Math.min(1, LOOK_WIDTH / view.videoWidth);
          canvas.width = Math.round(view.videoWidth * scale);
          canvas.height = Math.round(view.videoHeight * scale);
          context.drawImage(view, 0, 0, canvas.width, canvas.height);
          const picture = context.getImageData(0, 0, canvas.width, canvas.height);
          const code = jsQR(picture.data, picture.width, picture.height, { inversionAttempts: 'dontInvert' });
          if (code?.data) {
            close();
            handlers.current.onFound(code.data);
          }
        }, LOOK_EVERY_MS);
      } catch (error) {
        if (closed) {
          return;
        }
        close();
        handlers.current.onFail(cameraError(error));
      }
    })();
    return close;
  }, []);

  return (
    <ScanOverlay hint={syncCopy.pairing.cameraScanHint} onCancel={onCancel}>
      <video ref={video} className="scan-video" muted playsInline />
    </ScanOverlay>
  );
}

/** Why the camera didn't open, in words the person can act on. */
function cameraError(error: unknown): unknown {
  const name = error instanceof DOMException ? error.name : '';
  if (name === 'NotAllowedError') {
    return new Error(syncCopy.camera.notAllowed);
  }
  if (name === 'NotFoundError' || name === 'OverconstrainedError') {
    return new Error(syncCopy.camera.notFound);
  }
  if (name === 'NotReadableError') {
    return new Error(syncCopy.camera.busy);
  }
  return error;
}
