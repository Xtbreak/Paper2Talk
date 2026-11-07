const { spawn } = require('node:child_process');
const { existsSync } = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const executable = process.platform === 'win32' ? 'aioncore.exe' : 'aioncore';
const backend = process.env.AIONUI_BACKEND_BIN || path.resolve(root, '../AionCore/target/debug', executable);
if (!existsSync(backend)) {
  console.error('Build AionCore with cargo build --locked --bin aioncore or set AIONUI_BACKEND_BIN.');
  process.exit(1);
}
const vite = require.resolve('electron-vite/package.json');
const cli = path.resolve(path.dirname(vite), require(vite).bin['electron-vite']);
const report = process.argv[2];
if (report && !/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(report)) {
  console.error('Expected a Paper2Talk report UUID.');
  process.exit(1);
}
const child = spawn(process.execPath, [cli, 'dev', '--config', 'packages/desktop/electron.vite.config.ts'], {
  cwd: root,
  env: { ...process.env, AIONUI_BACKEND_BIN: backend, PAPER2TALK_START: '1', PAPER2TALK_REPORT: report || '' },
  stdio: 'inherit',
});
child.on('error', (error) => {
  console.error(error.message);
  process.exitCode = 1;
});
child.on('exit', (code) => {
  process.exitCode = code ?? 1;
});
