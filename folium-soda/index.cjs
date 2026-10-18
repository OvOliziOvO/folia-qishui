'use strict';
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const crypto = require('node:crypto');
const readline = require('node:readline');
const { spawn } = require('node:child_process');
const startSigningRuntime = require('./signingRuntime.cjs');

// Qishui worker RPC and a seekable loopback audio endpoint for decoded media.
module.exports = function activate(api) {
    const pending = new Map();
    const media = new Map();
    const dataDir = api.storage.paths.data;
    const cacheDir = api.storage.paths.cache;
    const sessionFile = path.join(dataDir, 'session.cookie');
    let nextId = 1;
    let worker;
    let starting;
    let signer;
    let disposed = false;
    const server = http.createServer((request, response) => {
        response.setHeader('Access-Control-Allow-Origin', '*');
        response.setHeader('Accept-Ranges', 'bytes');
        if (request.method === 'OPTIONS') { response.writeHead(204); response.end(); return; }
        const file = media.get(request.url);
        if (!file) { response.writeHead(404); response.end(); return; }
        const size = fs.statSync(file).size;
        const mime = { '.flac': 'audio/flac', '.mp3': 'audio/mpeg', '.m4a': 'audio/mp4', '.mp4': 'audio/mp4', '.aac': 'audio/aac' }[path.extname(file)] || 'application/octet-stream';
        let start = 0, end = size - 1;
        if (request.headers.range) {
            const [, first, last] = /^bytes=(\d*)-(\d*)$/.exec(request.headers.range) || [];
            if (first === undefined) { response.writeHead(416, { 'Content-Range': `bytes */${size}` }); response.end(); return; }
            if (first) { start = Number(first); end = last ? Math.min(Number(last), size - 1) : size - 1; }
            else { start = Math.max(0, size - Number(last)); }
            if (start > end || start >= size) { response.writeHead(416, { 'Content-Range': `bytes */${size}` }); response.end(); return; }
            response.setHeader('Content-Range', `bytes ${start}-${end}/${size}`);
        }
        response.writeHead(request.headers.range ? 206 : 200, { 'Content-Type': mime, 'Content-Length': end - start + 1 });
        if (request.method === 'HEAD') { response.end(); return; }
        const stream = fs.createReadStream(file, { start, end });
        stream.pipe(response);
        response.on('close', () => stream.destroy());
    });
    const listening = new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    async function startWorker() {
        signer ??= await startSigningRuntime(dataDir, api.log);
        if (disposed) { signer.stop(); throw new Error('汽水模组已停用'); }
        const executable = path.join(__dirname, 'bin', 'soda-bridge');
        fs.chmodSync(executable, 0o755);
        const env = { ...process.env, SODA_SESSION_FILE: sessionFile, SODA_CACHE_DIR: cacheDir, ...signer.env };
        const credentials = path.join(dataDir, 'app-credentials.json');
        if (fs.existsSync(credentials)) env.SODA_APP_CREDENTIALS = credentials;
        if (!env.QISHUI_CHROMIUM_PATH) env.QISHUI_CHROMIUM_PATH = '/opt/google/chrome/chrome';
        worker = spawn(executable, [], { cwd: __dirname, env, stdio: ['pipe', 'pipe', 'pipe'] });
        readline.createInterface({ input: worker.stdout }).on('line', line => {
            const message = JSON.parse(line);
            const entry = pending.get(message.id);
            if (!entry) return;
            pending.delete(message.id);
            if (message.ok) entry.resolve(message.result);
            else entry.reject(new Error(message.error.message));
        });
        worker.stderr.on('data', chunk => api.log.warn('[SodaBridge] ' + chunk.toString()));
        const failed = error => {
            worker = undefined;
            starting = undefined;
            for (const entry of pending.values()) entry.reject(error);
            pending.clear();
        };
        worker.on('error', failed);
        worker.on('exit', code => failed(new Error(`汽水桥接进程退出（${code}）`)));
        return worker;
    }
    async function call(method, params = {}) {
        const child = worker || await (starting ??= startWorker());
        const id = nextId++;
        return new Promise((resolve, reject) => {
            pending.set(id, { resolve, reject });
            child.stdin.write(JSON.stringify({ id, method, params }) + '\n');
        });
    }
    const methods = ['search', 'getSong', 'getLyrics', 'diagnostics', 'getAccount', 'authStatus', 'qrCreate', 'qrPoll', 'qrVerify', 'logout', 'getUserPlaylists', 'getUserAlbums', 'getLikedSongs', 'getPlaylist', 'getAlbum', 'getRecommendedCollections', 'likeSong', 'updatePlaylistTracks', 'subscribePlaylist', 'subscribeAlbum'];
    for (const method of methods) api.rpc.handle(`soda.${method}`, params => call(method, params));
    api.rpc.handle('soda.getAudioUrl', async params => {
        const result = await call('getAudioUrl', params);
        if (result.path) {
            await listening;
            const route = '/' + crypto.randomUUID();
            media.set(route, result.path);
            result.url = `http://127.0.0.1:${server.address().port}${route}`;
            delete result.path;
        }
        return result;
    });
    api.log.info('[Soda] 汽水音乐 0.5.0 已就绪');
    return () => {
        disposed = true;
        worker?.kill();
        signer?.stop();
        server.closeAllConnections();
        server.close();
        media.clear();
    };
};
