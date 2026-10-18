// Adapt Qishui account and catalog operations to Folia's existing Omni contract.
const providerId = 'folium.folium-soda-qishui.qishui';
const mediaId = value => String(typeof value === 'object' ? value.sourceRef?.mediaId ?? value.id : value);
export function unifiedSong(song) {
    const artists = song.artistDetails ?? song.artists.map((name, index) => ({ id: `${song.id}#artist${index}`, name }));
    const album = song.albumDetails ?? { id: `${song.id}#album`, name: song.album };
    return {
        id: song.id, name: song.title,
        artists: artists.map(artist => ({ ...artist, catalogRef: { providerId, kind: 'artist', id: artist.id } })),
        album: { ...album, coverUrl: song.coverUrl, catalogRef: { providerId, kind: 'album', id: album.id } },
        durationMs: song.durationMs,
        sourceRef: { kind: 'online', providerId, mediaId: song.id },
    };
}
export function extendProvider(folium, base) {
    const rpc = (method, params = {}) => folium.rpc.call(`soda.${method}`, params);
    const collection = item => ({ ...item, providerId });
    const collectionPage = async (method, limit, offset) => {
        const result = await rpc(method, { limit, offset });
        return { ...result, items: result.items.map(collection) };
    };
    const songPage = (songs, limit, offset) => ({ items: songs.slice(offset, offset + limit).map(unifiedSong), total: songs.length, nextOffset: Math.min(offset + limit, songs.length), hasMore: offset + limit < songs.length });
    const catalog = async (kind, id) => rpc(kind === 'album' ? 'getAlbum' : 'getPlaylist', { id: String(id) });
    let qrImage;
    return {
        ...base,
        capabilities: { ...base.capabilities, auth: true, userLibrary: true, playlists: true, albums: true, recommendations: true, mutations: true, playlistSubscription: true, playlistTrackMutations: true, likes: true, userAlbums: true },
        normalizeSong: raw => raw.sourceRef ? raw : unifiedSong(raw),
        normalizeUser: raw => raw,
        normalizeCollection: collection,
        getSongPageUrl: song => `https://music.douyin.com/qishui/song/${mediaId(song)}`,
        search: { searchSongs: async (query, limit, offset) => {
            const result = await rpc('search', { query, page: { limit, offset } });
            return { ...result, items: result.items.map(unifiedSong), nextOffset: offset + result.items.length };
        } },
        playback: {
            getSongDetail: async id => unifiedSong(await rpc('getSong', { id: String(id) })),
            getAudioSource: async (song, quality) => {
                const result = await rpc('getAudioUrl', { song: { id: mediaId(song) }, quality });
                if (result.isPreview) folium.ui.toast(result.note || '汽水音乐当前返回试听片段', { type: 'info' });
                const actual = { lossless: 'lossless', highest: 'high', higher: 'high', medium: 'standard', low: 'standard' }[result.quality] ?? quality;
                return { url: result.url, quality: actual, fetchedAt: Date.now() };
            },
        },
        auth: {
            getLoginStatus: () => rpc('getAccount'),
            logout: () => rpc('logout'),
            getQrKey: async () => { const result = await rpc('qrCreate'); qrImage = result.qrImage; return 'qishui'; },
            createQr: async () => qrImage,
            checkQr: async () => {
                const result = await rpc('qrPoll');
                if (result.needSecondVerify) return { state: 'error', message: '请在「汽水账号」页打开官方二次验证' };
                if (result.status === 'success') await folium.internals.omni.refreshProviderAccount(providerId);
                return { state: { success: 'confirmed', waiting: 'waiting', scanned: 'scanned', expired: 'expired', failed: 'error' }[result.status] ?? 'waiting', message: result.message };
            },
        },
        library: {
            getUserPlaylists: (_user, limit, offset) => collectionPage('getUserPlaylists', limit, offset),
            getUserAlbums: (_user, limit, offset) => collectionPage('getUserAlbums', limit, offset),
            getLikedSongs: async () => (await rpc('getLikedSongs')).map(unifiedSong),
            getLikedSongIds: async () => (await rpc('getLikedSongs')).map(song => song.id),
        },
        catalog: {
            getPlaylistTracks: async (id, limit, offset) => songPage((await catalog('playlist', id)).songs, limit, offset),
            getPlaylistDetail: async (id, existing) => ({ ...collection((await catalog('playlist', id)).collection), isOwned: existing?.isOwned ?? false }),
            getAlbumTracks: async (id, limit = 30, offset = 0) => songPage((await catalog('album', id)).songs, limit, offset),
            getAlbumDetail: async id => collection((await catalog('album', id)).collection),
            getSubscriptionStatus: async (type, id) => (await collectionPage(type === 'album' ? 'getUserAlbums' : 'getUserPlaylists', Number.MAX_SAFE_INTEGER, 0)).items.some(item => String(item.id) === String(id) && !item.isOwned),
        },
        recommendations: { getRecommendedCollections: async limit => (await rpc('getRecommendedCollections', { limit })).map(collection) },
        mutations: {
            canAddToPlaylist: item => item.isOwned === true && item.providerData?.playlistType === '2',
            canEditPlaylistTracks: item => item.isOwned === true && item.providerData?.playlistType === '2',
            likeSong: (song, liked) => rpc('likeSong', { id: mediaId(song), liked }),
            updatePlaylistTracks: (operation, playlist, tracks) => rpc('updatePlaylistTracks', { operation, id: mediaId(playlist), ids: tracks.map(mediaId) }),
            subscribePlaylist: (playlist, subscribed) => rpc('subscribePlaylist', { id: mediaId(playlist), subscribed }),
            subscribeAlbum: (id, subscribed) => rpc('subscribeAlbum', { id: String(id), subscribed }),
        },
    };
}
