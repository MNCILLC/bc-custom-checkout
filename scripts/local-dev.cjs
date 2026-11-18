const { spawn } = require('node:child_process');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
process.loadEnvFile(path.join(root, '.env.local'));
process.env.NODE_ENV = 'development';
const child = spawn(
    process.execPath,
    [require.resolve('webpack-cli/bin/cli.js'), 'serve', '--mode', 'development'],
    { cwd: root, env: process.env, stdio: 'inherit' },
);
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill(signal));
child.on('exit', (code) => {
    process.exitCode = code || 0;
});
