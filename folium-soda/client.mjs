import { extendProvider } from './provider.mjs';

// Register the Qishui source and its account page in Folia.
const label = (zh, en = zh) => ({ 'zh-CN': zh, 'zh-TW': zh, en, in: en });
function mountAccount(container, folium, syncAccount) {
    let alive = true;
    let generation = 0;
    let timer;
    const call = (method, params = {}) => folium.rpc.call(`soda.${method}`, params);
    const root = document.createElement('section');
    Object.assign(root.style, { padding: '28px', maxWidth: '640px', margin: '0 auto', display: 'flex', flexDirection: 'column', gap: '16px', color: 'inherit' });
    const title = document.createElement('h2'); title.textContent = '汽水音乐';
    const status = document.createElement('p'); status.setAttribute('role', 'status'); status.textContent = '正在查询汽水账号…';
    const avatar = document.createElement('img'); avatar.hidden = true; avatar.style.width = '64px'; avatar.style.borderRadius = '50%';
    const qr = document.createElement('img'); qr.alt = '汽水音乐登录二维码'; qr.hidden = true;
    Object.assign(qr.style, { width: '260px', padding: '10px', borderRadius: '14px', background: 'white', alignSelf: 'center' });
    const actions = document.createElement('div'); Object.assign(actions.style, { display: 'flex', gap: '12px', flexWrap: 'wrap' });
    function button(text, action) {
        const element = document.createElement('button'); element.textContent = text; element.type = 'button';
        Object.assign(element.style, { color: 'inherit', background: 'transparent', border: '1px solid currentColor', borderRadius: '10px', padding: '10px 16px', cursor: 'pointer' });
        element.onclick = async () => {
            element.disabled = true;
            try { await action(); } catch (error) { if (alive) status.textContent = error.message; }
            finally { element.disabled = false; }
        };
        actions.append(element); return element;
    }
    const login = button('扫码登录', startLogin);
    const verify = button('打开官方二次验证', () => call('qrVerify')); verify.hidden = true;
    const logout = button('退出汽水账号', async () => {
        generation++; clearTimeout(timer); await call('logout'); await syncAccount(); qr.hidden = true; avatar.hidden = true; verify.hidden = true; await refresh();
    }); logout.hidden = true;
    const note = document.createElement('p'); note.textContent = '登录后在 Folia 音源菜单选择「汽水」，即可使用账号、歌单和收藏。音质跟随 Folia 播放设置。';
    root.append(title, avatar, status, qr, actions, note); container.replaceChildren(root);
    async function refresh() {
        const result = await call('authStatus'); if (!alive) return;
        status.textContent = result.loggedIn ? `${result.user.nickname}${result.user.vipType ? ' · VIP' : ''}` : '未登录';
        logout.hidden = !result.loggedIn;
        login.textContent = result.loggedIn ? '重新扫码登录' : '扫码登录';
        if (result.loggedIn && result.user.avatarUrl) { avatar.src = result.user.avatarUrl; avatar.hidden = false; }
    }
    async function startLogin() {
        const current = ++generation; clearTimeout(timer); verify.hidden = true; qr.hidden = true;
        status.textContent = '正在生成汽水音乐二维码…';
        const result = await call('qrCreate');
        if (!alive || current !== generation) return;
        qr.src = result.qrImage; qr.hidden = false; status.textContent = '打开手机汽水音乐 App 扫码，并在手机上确认登录';
        timer = setTimeout(() => poll(current), 3000);
    }
    async function poll(current) {
        try {
            const result = await call('qrPoll'); if (!alive || current !== generation) return;
            status.textContent = result.message || '等待扫码确认…'; verify.hidden = !result.needSecondVerify;
            if (result.status === 'success') { qr.hidden = true; verify.hidden = true; await refresh(); await syncAccount(); folium.ui.toast('汽水音乐登录成功', { type: 'success' }); return; }
            if (result.status === 'expired' || result.status === 'failed') { qr.hidden = true; return; }
            timer = setTimeout(() => poll(current), 3000);
        } catch (error) { if (alive && current === generation) { status.textContent = error.message; qr.hidden = true; } }
    }
    refresh().catch(error => { if (alive) status.textContent = error.message; });
    return () => { alive = false; generation++; clearTimeout(timer); container.replaceChildren(); };
}
export default function activate(folium) {
    const call = (method, params = {}) => folium.rpc.call(`soda.${method}`, params);
    const provider = folium.experimental['omni.providers'].register({
        id: 'qishui', displayName: '汽水音乐', shortName: '汽水',
        search: (query, page) => call('search', { query, page }),
        getSong: id => call('getSong', { id }),
        getAudioUrl: async (song, quality) => {
            const result = await call('getAudioUrl', { song: { id: song.id }, quality });
            if (result.isPreview) folium.ui.toast(result.note || '当前歌曲为试听片段', { type: 'info' });
            return result;
        },
        getLyrics: song => call('getLyrics', { song: { id: song.id } }),
        extendProvider: base => extendProvider(folium, base),
    });
    const syncAccount = () => folium.internals.omni.refreshProviderAccount('folium.folium-soda-qishui.qishui');
    void syncAccount().catch(error => folium.log.error(error.message));
    const home = folium.registries.homeTabs.register({ id: 'account', label: label('汽水账号', 'Qishui Account'), order: 800, mount: container => mountAccount(container, folium, syncAccount) });
    const command = folium.registries.commands.register({ id: 'account', label: label('汽水音乐 · 登录/账号', 'Qishui · Account'), description: label('扫码登录汽水音乐'), keywords: ['汽水', '登录', 'Soda', 'Qishui'], run: () => folium.ui.openHomeTab('account') });
    const diagnostics = folium.registries.commands.register({ id: 'diagnostics', label: label('检查汽水音源', 'Check Qishui'), run: async () => {
        const result = await call('diagnostics'); const message = `汽水桥接 ${result.bridgeVersion} · ${result.mode === 'signed-in' ? '已保存会话' : '未登录'}`;
        folium.ui.toast(message, { type: 'success' }); return { message };
    } });
    return () => { diagnostics.unregister(); command.unregister(); home.unregister(); provider.unregister(); };
}
