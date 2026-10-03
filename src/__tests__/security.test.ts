/// <reference types="node" />
// Security tripwires. These read the app's own files and check it can't do more than it needs: which
// permissions the page has, which Rust commands it can call, where the network is used, which packages are
// used. A change that gives the app more power fails here, so it can't slip in without a change to this file.
// If one fails, read the change that caused it carefully before you update the list here.

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const read = (path: string) => readFileSync(join(ROOT, path), 'utf8');

/** Every file under `dir` whose name matches `name`, as paths from the project folder. */
function filesIn(dir: string, name: RegExp): string[] {
  return readdirSync(join(ROOT, dir)).flatMap((entry) => {
    const path = join(dir, entry);
    if (statSync(join(ROOT, path)).isDirectory()) {
      return filesIn(path, name);
    }
    return name.test(entry) ? [relative(ROOT, join(ROOT, path))] : [];
  });
}

/** The files where `pattern` shows up. */
function filesUsing(files: string[], pattern: RegExp): string[] {
  return files.filter((file) => pattern.test(read(file)));
}

describe('what the page is allowed to do', () => {
  it('has only the permissions it needs', () => {
    expect(readdirSync(join(ROOT, 'src-tauri/capabilities')).sort()).toEqual(['default.json', 'mobile.json']);
    const permissions = (file: string) => JSON.parse(read(`src-tauri/capabilities/${file}`)).permissions;
    // Files only through the open and save dialogs: the page can touch only the file the person picked (and
    // check its size before reading it).
    expect(permissions('default.json')).toEqual([
      'core:default',
      'store:default',
      'dialog:allow-open',
      'dialog:allow-save',
      'fs:allow-read-text-file',
      'fs:allow-stat',
      'fs:allow-write-text-file',
    ]);
    // The QR scanner, only on Android: sync isn't on iPhone yet.
    expect(JSON.parse(read('src-tauri/capabilities/mobile.json')).platforms).toEqual(['android']);
    expect(permissions('mobile.json')).toEqual([
      'barcode-scanner:allow-scan',
      'barcode-scanner:allow-cancel',
      'barcode-scanner:allow-check-permissions',
      'barcode-scanner:allow-request-permissions',
      'barcode-scanner:allow-open-app-settings',
    ]);
  });

  it("can't load anything from outside the app or run text as code", () => {
    const config = JSON.parse(read('src-tauri/tauri.conf.json'));
    expect(config.app.security).toEqual({
      csp:
        "default-src 'self'; img-src 'self' data:; media-src 'self' blob: data:; style-src 'self' 'unsafe-inline'; " +
        "connect-src 'self' ipc: http://ipc.localhost",
    });
    expect(config.plugins).toBeUndefined();
  });

  it('can call only these Rust commands', () => {
    const handler = /generate_handler!\[([^\]]*)\]/.exec(read('src-tauri/src/lib.rs'))?.[1] ?? '';
    const commands = handler
      .split(',')
      .map((c) => c.trim())
      .filter(Boolean);
    expect(commands.sort()).toEqual([
      'sync::pair_cancel',
      'sync::pair_join',
      'sync::pair_start',
      'sync::sync_forget',
      'sync::sync_listen',
      'sync::sync_now',
      'sync::sync_rename',
      'sync::sync_rounds',
      'sync::sync_status',
      'sync::sync_stop',
    ]);
  });

  it('never talks to the network itself or runs text as code', () => {
    const page = filesIn('src', /\.tsx?$/).filter((f) => !f.includes('__tests__'));
    // Only to load the app's own sound files (the page's rules allow nothing else).
    expect(filesUsing(page, /\bfetch\(/)).toEqual(['src/lib/speech.ts']);
    expect(filesUsing(page, /XMLHttpRequest|WebSocket|EventSource|sendBeacon|window\.open/)).toEqual([]);
    expect(filesUsing(page, /\beval\(|new Function|\.innerHTML|outerHTML|insertAdjacentHTML|document\.write/)).toEqual(
      [],
    );
    // Only the app's built-in icons go in as raw SVG.
    expect(filesUsing(page, /dangerouslySetInnerHTML/)).toEqual(['src/components/ui/icon.tsx']);
  });
});

describe('the camera', () => {
  it('is opened only to scan a QR code, and never with the microphone', () => {
    const page = filesIn('src', /\.tsx?$/).filter((f) => !f.includes('__tests__'));
    expect(filesUsing(page, /getUserMedia\(/)).toEqual(['src/sync/sync-scan.tsx']);
    expect(read('src/sync/sync-scan.tsx')).toContain(
      "getUserMedia({ video: { facingMode: 'environment' }, audio: false })",
    );
  });

  it('is the only thing Linux lets the page use, and only for the app itself', () => {
    const lib = read('src-tauri/src/lib.rs');
    expect(lib).toContain('ours && media.is_for_video_device() && !media.is_for_audio_device()');
    expect(lib).toContain('_ => request.deny(),');
    expect(lib.match(/request\.allow\(\)/g)).toHaveLength(1);
  });

  it('is the only extra thing macOS lets the app use', () => {
    const entitlements = read('src-tauri/Entitlements.plist');
    expect([...entitlements.matchAll(/<key>([^<]+)<\/key>/g)].map((m) => m[1])).toEqual([
      'com.apple.security.device.camera',
    ]);
  });
});

describe('what the Rust side does', () => {
  // The tests (in files named tests.rs) open connections of their own, so they're left out.
  const rust = filesIn('src-tauri/src', /\.rs$/).filter((f) => !f.endsWith('tests.rs'));

  it('opens network connections only in the sync code', () => {
    expect(filesUsing(rust, /TcpStream::connect/)).toEqual(['src-tauri/src/sync/wire.rs']);
    expect(filesUsing(rust, /TcpListener::bind/)).toEqual(['src-tauri/src/sync/commands.rs']);
    expect(filesUsing(rust, /UdpSocket|reqwest|hyper|ureq|http::/)).toEqual([]);
  });

  it('never runs other programs or unchecked code', () => {
    expect(filesUsing(rust, /process::Command|Command::new|\bunsafe\b|libc::|extern "C"/)).toEqual([]);
  });

  it('keeps sync to the home network and to its two ports', () => {
    const address = read('src-tauri/src/sync/address.rs');
    expect(address).toContain('pub const PAIR_PORT: u16 = 47_391;');
    expect(address).toContain('pub const SYNC_PORT: u16 = 47_392;');
    expect(address).toMatch(/pub fn is_home\(ip: Ipv4Addr\) -> bool \{\s*ip\.is_private\(\)\s*\}/);
  });
});

describe('the Android app', () => {
  it('asks for no permissions beyond the network', () => {
    const manifest = read('src-tauri/gen/android/app/src/main/AndroidManifest.xml');
    const asked = [...manifest.matchAll(/uses-permission android:name="([^"]+)"/g)].map((m) => m[1]);
    expect(asked).toEqual(['android.permission.INTERNET']);
  });

  it('keeps the sync key out of backups and phone moves', () => {
    const manifest = read('src-tauri/gen/android/app/src/main/AndroidManifest.xml');
    expect(manifest).toContain('android:fullBackupContent="@xml/backup_rules"');
    expect(manifest).toContain('android:dataExtractionRules="@xml/data_extraction_rules"');
    const rules = read('src-tauri/gen/android/app/src/main/res/xml/data_extraction_rules.xml');
    for (const where of ['cloud-backup', 'device-transfer']) {
      const section = new RegExp(`<${where}>([\\s\\S]*?)</${where}>`).exec(rules)?.[1] ?? '';
      expect(section).toContain('<exclude domain="root" path="sync.json" />');
    }
    expect(read('src-tauri/gen/android/app/src/main/res/xml/backup_rules.xml')).toContain(
      '<exclude domain="root" path="sync.json" />',
    );
  });
});

describe('the packages the app is built from', () => {
  // A new package is the easiest way to hide code in an app. Version updates (Dependabot) don't change these.
  it('uses only these JavaScript packages', () => {
    const pkg = JSON.parse(read('package.json'));
    expect(Object.keys(pkg.dependencies).sort()).toEqual([
      '@tauri-apps/api',
      '@tauri-apps/plugin-barcode-scanner',
      '@tauri-apps/plugin-dialog',
      '@tauri-apps/plugin-fs',
      '@tauri-apps/plugin-store',
      'clsx',
      'ionicons',
      'jsqr',
      'react',
      'react-dom',
      'tailwind-merge',
      'uplot',
      'zustand',
    ]);
    expect(Object.keys(pkg.devDependencies).sort()).toEqual([
      '@eslint/js',
      '@tailwindcss/vite',
      '@tauri-apps/cli',
      '@types/node',
      '@types/react',
      '@types/react-dom',
      '@vitejs/plugin-react',
      'eslint',
      'eslint-plugin-react-hooks',
      'globals',
      'husky',
      'prettier',
      'tailwindcss',
      'typescript',
      'typescript-eslint',
      'vite',
      'vitest',
    ]);
  });

  it('uses only these Rust packages', () => {
    const names: string[] = [];
    let inDependencies = false;
    for (const line of read('src-tauri/Cargo.toml').split('\n')) {
      if (line.startsWith('[')) {
        inDependencies = /dependencies\]$/.test(line.trim());
      }
      const name = /^([A-Za-z0-9_-]+)\s*=/.exec(line)?.[1];
      if (inDependencies && name) {
        names.push(name);
      }
    }
    expect(names.sort()).toEqual([
      'chacha20poly1305',
      'getrandom',
      'if-addrs',
      'keyring',
      'qrcode',
      'serde',
      'serde_json',
      'snow',
      'spake2',
      'tauri',
      'tauri-build',
      'tauri-plugin-barcode-scanner',
      'tauri-plugin-dialog',
      'tauri-plugin-fs',
      'tauri-plugin-store',
      'tokio',
      'tokio',
      'webkit2gtk',
      'zeroize',
    ]);
  });
});
