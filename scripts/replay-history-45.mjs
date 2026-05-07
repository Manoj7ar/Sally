/**
 * Replay the tree at TARGET (default: HEAD) as 45 commits from merge-base 6d7d996.
 * Uses `git checkout TARGET -- .` after resetting to the base so the working tree
 * exactly matches TARGET (no local editor drift).
 *
 *   node scripts/replay-history-45.mjs
 */
import { execSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
process.chdir(root);

function sh(cmd) {
  execSync(cmd, { stdio: 'inherit', shell: true });
}

function commit(msg) {
  sh(`git commit -m "${msg.replace(/"/g, '\\"')}"`);
}

function show(rev, path) {
  return execSync(`git show ${rev}:${path}`, { encoding: 'utf8', maxBuffer: 50 * 1024 * 1024 });
}

const targetTree = execSync('git rev-parse HEAD', { encoding: 'utf8' }).trim();
const baseRev = '6d7d996';

const snap = {
  readme: show(targetTree, 'README.md'),
  arch: show(targetTree, 'docs/architecture.md'),
  pkg: show(targetTree, 'package.json'),
};

const basePkgStr = show(baseRev, 'package.json');

sh(`git reset --hard ${baseRev}`);
sh(`git checkout ${targetTree} -- .`);
sh('git reset HEAD');

// --- 1–2: backend ---
sh('git rm -f sally-backend/Dockerfile sally-backend/cloudbuild.yaml sally-backend/deploy.sh');
commit('chore(backend): remove Cloud Run container and CI config files');

sh('git rm -f sally-backend/index.js sally-backend/logger.js sally-backend/package.json sally-backend/package-lock.json');
commit('chore(backend): remove Node proxy entrypoint and npm metadata');

// --- 3–5: env + store ---
sh('git add .env.example');
commit('docs(env): document direct Gemini BYOK in example env');

sh('git add electron/main/utils/constants.ts');
commit('refactor(store): drop backend-related store key constants');

sh('git add electron/main/utils/store.ts');
commit('refactor(store): align persisted defaults with BYOK-only flow');

// --- 6–7: keys ---
sh('git add electron/main/managers/apiKeyManager.ts');
commit('refactor(keys): add open-at-login and simplify key accessors');

sh('git add tests/electron/main/managers/apiKeyManager.test.ts');
commit('test(keys): update apiKeyManager expectations after BYOK cleanup');

// --- 8–10: gemini ---
sh('git add electron/main/services/geminiService.ts');
commit('feat(gemini): call Generative Language API without Cloud proxy');

sh('git add electron/main/services/geminiNormalizers.ts');
commit('feat(gemini): validate Gemini payloads with strict normalizers');

sh('git add tests/electron/main/services/geminiNormalizers.test.ts');
commit('test(gemini): cover strict normalizer error paths');

// --- 11–14: logging ---
sh('git rm -f electron/main/services/cloudLoggerCore.ts');
commit('refactor(logging): remove cloud logger batch core module');

sh('git rm -f tests/electron/main/services/cloudLoggerCore.test.ts');
commit('test(logging): remove cloud logger core batch tests');

sh('git add electron/main/services/cloudLogger.ts');
commit('refactor(logging): route logs through local append-only cloudLogger');

sh('git add tests/electron/main/services/cloudLogger.test.ts');
commit('test(logging): cover local cloudLogger behavior');

// --- 15: tts ---
sh('git add electron/main/services/ttsService.ts');
commit('chore(tts): align ElevenLabs client with simplified desktop stack');

// --- 16–17: session + power ---
sh('git add electron/main/utils/powerGuard.ts');
commit('feat(session): add power-save blocker helper for active agent states');

sh('git add electron/main/managers/sessionManager.ts');
commit('feat(session): BYOK-only orchestration and wire display sleep guard');

// --- 18–22: mac infra ---
sh('git rm -f electron/main/utils/browserDiscovery.ts');
commit('chore: remove unused browser discovery helper');

sh('git add electron/main/hotkeyManager.ts');
commit('feat(mac): macOS-only uiohook push-to-talk hotkey path');

sh('git add electron/main/windowManager.ts');
commit('feat(mac): screen-saver level windows and content protection');

sh('git add electron/main/managers/macPermissionsManager.ts');
commit('feat(mac): poll System Settings permissions and broadcast status');

sh('git add electron/main/macIntegration.ts');
commit('feat(mac): native app menu, About panel, dock menu, summon shortcut');

// --- 23–25: entry + ipc + mic ---
sh('git add electron/main/index.ts');
commit('feat(mac): darwin-only startup gate and permission watcher wiring');

sh('git add electron/main/ipcHandlers.ts');
commit('feat(ipc): permissions channels and open-at-login handler');

sh('git add electron/main/managers/microphoneManager.ts');
commit('feat(mac): refresh dock mute label when mic state changes');

// --- 26–31: shared + renderer ---
sh('git add shared/types.ts');
commit('feat(types): mac permission panes and IPC channel definitions');

sh('git add electron/preload/index.ts');
commit('feat(preload): slim electron bridge without platform metadata');

sh('git add shared/pushToTalkLabel.ts');
commit('feat(shared): constant push-to-talk label for macOS-only UI');

sh('git add tests/shared/pushToTalkLabel.test.ts');
commit('test(shared): cover push-to-talk label constant');

sh('git add src/lib/desktopMeta.ts');
commit('feat(renderer): desktop meta helper for Sally bar copy');

sh('git add src/lib/ipc.ts');
commit('feat(renderer): remove obsolete ipc platform helper');

// --- 32–34: ui ---
sh('git add src/windows/config/ConfigWindow.tsx');
commit('feat(ui): Settings permissions card and open-at-login toggle');

sh('git add src/index.css');
commit('feat(ui): system font stack for native macOS typography');

sh('git add src/windows/sallyBar/SallyBarWindow.tsx');
commit('feat(ui): align Sally bar copy with macOS push-to-talk label');

// --- 35–39: README cumulative slices ---
const readmeLines = snap.readme.split(/\r?\n/);
const rEnds = [65, 128, 190, 303, readmeLines.length];
let rPart = 1;
for (const endLine of rEnds) {
  const chunk = readmeLines.slice(0, endLine).join('\n');
  writeFileSync(join(root, 'README.md'), `${chunk}\n`, 'utf8');
  sh('git add README.md');
  commit(`docs(readme): macOS and BYOK refresh (part ${rPart}/5)`);
  rPart++;
}

// --- 40–41: architecture (truncated then full snapshot) ---
const archLines = snap.arch.split(/\r?\n/);
const midLine = Math.floor(archLines.length / 2);
let splitIdx = archLines.findIndex((line, i) => i >= midLine && /^## /.test(line));
if (splitIdx < 0) splitIdx = midLine;
writeFileSync(
  join(root, 'docs', 'architecture.md'),
  `${archLines.slice(0, splitIdx).join('\n')}\n`,
  'utf8',
);
sh('git add docs/architecture.md');
commit('docs(architecture): product overview through Gemini pipeline (part 1/2)');

writeFileSync(join(root, 'docs', 'architecture.md'), snap.arch, 'utf8');
sh('git add docs/architecture.md');
commit('docs(architecture): Electron loop, IPC, security, and macOS integration (part 2/2)');

// --- 42–43: doctor + test ---
sh('git add scripts/desktop-doctor.ts');
commit('chore(scripts): tighten desktop-doctor for Sally desktop checks');

sh('git add tests/electron/main/managers/macPermissionsManager.test.ts');
commit('test(mac): cover macPermissionsManager status and polling');

// --- 44–45: package.json ---
const pkgObj = JSON.parse(basePkgStr);
pkgObj.scripts.check =
  'npm run lint && npm run typecheck && npm run test:run && npm run verify:desktop && npm run build';
writeFileSync(join(root, 'package.json'), `${JSON.stringify(pkgObj, null, 2)}\n`, 'utf8');
sh('git add package.json');
commit('build: drop sally-backend from npm check script');

writeFileSync(join(root, 'package.json'), snap.pkg, 'utf8');
sh('git add package.json');
commit('build: electron-builder mac universal dmg and trimmed targets');

sh('git status');

execSync(`git diff --quiet ${targetTree} HEAD`, { cwd: root, stdio: 'inherit' });
