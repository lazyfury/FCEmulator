// ---------------------------------------------------------------------------
// `npm run dev`
//
// Vite serves the renderer, Electron shows it, and the two are wired together
// by one environment variable. Any arguments after `--` are passed on to
// Electron, so this works too:
//
//   npm run dev -- --rom "/path/to/another game.nes"
//
// Writing this as a script rather than using two terminals is not laziness:
// Electron must not start until the dev server is actually listening, and
// hardcoding a port and hoping is exactly the kind of race that turns into
// ten minutes of "why is the window blank".
// ---------------------------------------------------------------------------

import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { createServer } from 'vite';
import electronPath from 'electron';

const electronRoot = fileURLToPath(new URL('..', import.meta.url));

// The main process is not part of Vite's world: it is compiled by tsc into
// dist-electron, and Electron loads it from there. Without this step, editing
// src/main/index.ts changes nothing until somebody remembers to run the build
// -- and the symptom is a feature that silently does not exist, which is a
// miserable way to spend an afternoon.
console.log('[dev] compiling the main process');
const compile = spawnSync('pnpm', ['exec', 'tsc', '-p', 'tsconfig.electron.json'], {
    cwd: electronRoot,
    stdio: 'inherit',
    shell: false,
});

if (compile.status !== 0) {
    console.error('[dev] the main process failed to compile');
    process.exit(compile.status ?? 1);
}

const server = await createServer({
    configFile: fileURLToPath(new URL('../vite.config.ts', import.meta.url)),
});

await server.listen();

const url = server.resolvedUrls?.local?.[0];
if (url === undefined) {
    console.error('[dev] vite started but reported no local url');
    await server.close();
    process.exit(1);
}

console.log(`[dev] renderer  ${url}`);
console.log(`[dev] emulator  ../wasm/dist/fc_core.wasm`);
console.log('[dev] quit with ctrl-c');

const electron = spawn(electronPath, ['.', ...process.argv.slice(2)], {
    cwd: electronRoot,
    stdio: 'inherit',
    env: { ...process.env, VITE_DEV_SERVER_URL: url },
});

let closing = false;
async function shutdown(code) {
    if (closing) {
        return;
    }
    closing = true;
    await server.close();
    process.exit(code ?? 0);
}

electron.on('exit', (code) => void shutdown(code));

// Ctrl-C reaches the whole process group, so Electron usually exits on its
// own. This is for the case where it does not.
process.on('SIGINT', () => electron.kill('SIGINT'));
process.on('SIGTERM', () => electron.kill('SIGTERM'));
