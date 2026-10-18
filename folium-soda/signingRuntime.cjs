'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const readline = require('node:readline');
const { spawn } = require('node:child_process');

// Run the user's official Qishui signing components through an isolated Wine prefix.
module.exports = async function startSigningRuntime(dataDir, log) {
    const runtime = path.join(dataDir, 'signing-runtime');
    const node = path.join(runtime, 'node.exe');
    if (!fs.existsSync(node)) return { env: {}, stop() {} };
    const windowsPath = file => 'Z:' + file.replaceAll('/', '\\');
    const token = crypto.randomBytes(32).toString('hex');
    const env = {
        ...process.env,
        WINEPREFIX: path.join(runtime, 'wine-prefix'),
        WINEDEBUG: '-all', WINEDLLOVERRIDES: 'mscoree,mshtml=',
        LIBMSSDK_BDMS_MODULE: windowsPath(path.join(runtime, 'bdms.node')),
        LIBMSSDK_STATE_DIR: windowsPath(runtime),
        LIBMSSDK_TOKEN: token, LIBMSSDK_BIND: '127.0.0.1', LIBMSSDK_PORT: '0',
    };
    const quote = value => "'" + value.replaceAll("'", "'\\''") + "'";
    const command = `stty cols 4096; exec wine ${quote(node)} ${quote(path.join(__dirname, 'signer', 'service.mjs'))}`;
    const child = spawn('script', ['-q', '-e', '-c', command, '/dev/null'], { env, detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
    const url = await new Promise((resolve, reject) => {
        child.once('error', reject);
        child.once('exit', code => reject(new Error(`汽水签名进程退出（${code}）`)));
        readline.createInterface({ input: child.stdout }).on('line', raw => {
            const line = raw.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '').trim();
            if (!line.startsWith('{')) return;
            const message = JSON.parse(line);
            if (message.event === 'ready') resolve(message.url);
        });
        child.stderr.on('data', chunk => log.warn('[SodaSigner] ' + chunk.toString()));
    });
    log.info('[SodaSigner] 本机汽水应用签名已启动');
    return {
        env: { QISHUI_SIGNER_URL: url + '/sign', QISHUI_SIGNER_TOKEN: token, SODA_APP_CREDENTIALS: path.join(runtime, 'identity.json') },
        stop() {
            process.kill(-child.pid, 'SIGTERM');
            spawn('/usr/lib/x86_64-linux-gnu/wine/wineserver', ['-k'], { env, stdio: 'ignore' });
        },
    };
};
