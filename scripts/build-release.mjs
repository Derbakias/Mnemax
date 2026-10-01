// Runs a Tauri release build, then copies what it made into release/ with names like
// Mnemax-0.1.0-x64.AppImage or Mnemax-0.1.0-universal.apk, ready to attach to a GitHub release.
//
//   node scripts/build-release.mjs desktop [extra tauri build args]
//   node scripts/build-release.mjs android [extra tauri android build args]
//
// Earlier build outputs are deleted first, so leftovers from older builds never get the new name.

import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = join(root, 'release');

const [mode, ...extraArgs] = process.argv.slice(2);
const TAURI_ARGS = {
  desktop: ['build'],
  android: ['android', 'build', '--apk'],
};
if (!TAURI_ARGS[mode]) {
  console.error('Usage: node scripts/build-release.mjs <desktop|android> [extra tauri args]');
  process.exit(1);
}

const { version } = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const { productName } = JSON.parse(readFileSync(join(root, 'src-tauri/tauri.conf.json'), 'utf8'));

// The architecture names each tool uses, mapped to the ones in our file names.
const ARCH = {
  amd64: 'x64',
  x86_64: 'x64',
  x64: 'x64',
  aarch64: 'arm64',
  arm64: 'arm64',
  i386: 'x86',
  i686: 'x86',
  x86: 'x86',
  armhf: 'armv7',
  armv7: 'armv7',
  arm: 'armv7',
  universal: 'universal',
};

const DESKTOP_TYPES = [
  { ext: '.AppImage' },
  { ext: '.deb' },
  { ext: '.rpm' },
  { ext: '.msi' },
  { ext: '-setup.exe', suffix: '-setup', outExt: '.exe' },
  { ext: '.dmg' },
];

function filesIn(dir) {
  if (!existsSync(dir)) {
    return [];
  }
  return readdirSync(dir, { recursive: true })
    .map((name) => join(dir, name))
    .filter((path) => statSync(path).isFile());
}

/**
 * The architecture in a bundle's file name, e.g. "Mnemax_0.1.0_amd64.deb" → "x64". Longer names are tried
 * first, so "x86_64" in "Mnemax-0.1.0-1.x86_64.rpm" isn't read as "x86".
 */
function archOf(name) {
  const known = Object.keys(ARCH).sort((a, b) => b.length - a.length);
  const found = known.find((arch) => new RegExp(`(^|[_.-])${arch}([_.-]|$)`).test(name));
  return found ? ARCH[found] : null;
}

/** [source path, release name] for each desktop bundle. */
function desktopArtifacts() {
  // Plain builds land in target/release; builds with --target in target/<triple>/release.
  const target = join(root, 'src-tauri/target');
  const bundleDirs = [join(target, 'release/bundle')];
  if (existsSync(target)) {
    for (const triple of readdirSync(target)) {
      bundleDirs.push(join(target, triple, 'release/bundle'));
    }
  }
  const out = [];
  for (const path of bundleDirs.flatMap(filesIn)) {
    const name = basename(path);
    const type = DESKTOP_TYPES.find((t) => name.endsWith(t.ext));
    if (!type) {
      continue;
    }
    const arch = archOf(name) ?? process.arch.replace('ia32', 'x86');
    const ext = type.outExt ?? type.ext;
    out.push([path, `${productName}-${version}-${arch}${type.suffix ?? ''}${ext}`]);
  }
  return out;
}

const ANDROID_ABIS = { 'arm64-v8a': 'arm64', 'armeabi-v7a': 'armv7', x86_64: 'x64', x86: 'x86' };

/**
 * Which ABIs an APK has native code for, read from its lib/<abi>/ entries. Tauri puts even a single-target
 * build (--target aarch64) in apk/universal/, so the folder name can't be trusted. Zip entry names are
 * stored as plain text, so a byte search finds them.
 */
function apkArch(path) {
  const bytes = readFileSync(path);
  const abis = Object.keys(ANDROID_ABIS).filter((abi) => bytes.includes(`lib/${abi}/`));
  return abis.length === 1 ? ANDROID_ABIS[abis[0]] : 'universal';
}

/** [source path, release name] for each release APK (apk/<flavor>/release/*.apk). */
function androidArtifacts() {
  const apkRoot = join(root, 'src-tauri/gen/android/app/build/outputs/apk');
  const out = [];
  for (const path of filesIn(apkRoot)) {
    const name = basename(path);
    if (!name.endsWith('.apk') || basename(dirname(path)) !== 'release') {
      continue;
    }
    const arch = apkArch(path);
    // An unsigned APK won't install on phones; keep that visible so it isn't uploaded by mistake.
    const unsigned = name.includes('-unsigned') ? '-unsigned' : '';
    out.push([path, `${productName}-${version}-${arch}${unsigned}.apk`]);
  }
  return out;
}

const findArtifacts = mode === 'desktop' ? desktopArtifacts : androidArtifacts;

// Clear the previous build's outputs; the build tools write them again (Gradle would otherwise skip an
// unchanged APK, and a --target build would leave the other architecture's files behind).
for (const [path] of findArtifacts()) {
  rmSync(path);
}

const tauriCli = createRequire(import.meta.url).resolve('@tauri-apps/cli/tauri.js');
const build = spawnSync(process.execPath, [tauriCli, ...TAURI_ARGS[mode], ...extraArgs], {
  cwd: root,
  stdio: 'inherit',
});
if (build.status !== 0) {
  process.exit(build.status ?? 1);
}

const artifacts = findArtifacts();
if (artifacts.length === 0) {
  console.error('\nThe build finished, but no release files were found to copy.');
  process.exit(1);
}
mkdirSync(outDir, { recursive: true });
console.log('\nRelease files:');
for (const [from, name] of artifacts) {
  copyFileSync(from, join(outDir, name));
  console.log(`  release/${name}`);
}
