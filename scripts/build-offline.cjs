const {spawnSync} = require('node:child_process');
const cli = require.resolve('expo/bin/cli');
const result = spawnSync(process.execPath, [cli, 'export', '--platform', 'web', '--max-workers', '1'], {stdio: 'inherit', env: {...process.env, CI: '1', EXPO_NO_TELEMETRY: '1'}});
if (result.error) throw result.error;
if (result.status !== 0) process.exit(result.status ?? 1);
require('./offline-manifest.cjs');
