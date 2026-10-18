'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { pathToFileURL } = require('node:url');

// Exercise registration, host routing and byte-range playback with real module entry points.
const ROOT = path.resolve(__dirname, '..');
test('client registers localized account entry and cleans up registrations', async () => {
    const saved = {}; const removed = [];
    const registry = name => ({ register(def) {
        if(name==='home') assert.equal(typeof def.label['zh-CN'], 'string');
        saved[name] ??= []; saved[name].push(def); return { unregister:()=>removed.push(name) };
    }});
    const folium = {internals:{omni:{refreshProviderAccount:async()=>null}},log:{error(){}},rpc:{call:async()=>null},experimental:{'omni.providers':registry('provider')},registries:{homeTabs:registry('home'),commands:registry('command')},ui:{openHomeTab(id){saved.tab=id}}};
    const { default: activate } = await import(pathToFileURL(path.join(ROOT, 'folium-soda/client.mjs')));
    const dispose=activate(folium);
    saved.command[0].run();assert.equal(saved.tab,'account');assert.equal(saved.provider[0].id,'qishui');
    dispose();assert.deepEqual(removed,['command','command','home','provider']);
});
test('native provider keeps source identity and actual resolved audio quality', async () => {
    const { extendProvider }=await import(pathToFileURL(path.join(ROOT,'folium-soda/provider.mjs')));
    const calls=[];const folium={rpc:{call:async(name,params)=>{calls.push({name,params}); if(name==='soda.search')return{items:[{id:'001',title:'Song',artists:['Artist'],album:'Album',durationMs:1234}],hasMore:true};if(name==='soda.getAudioUrl')return{url:'https://media.example/song',quality:'lossless'};}},ui:{toast(){}}};
    const provider=extendProvider(folium,{capabilities:{search:true,playback:true,lyrics:true}});
    const page=await provider.search.searchSongs('Song',10,20);assert.equal(page.nextOffset,21);assert.equal(page.items[0].sourceRef.providerId,providerId());
    const audio=await provider.playback.getAudioSource(page.items[0],'high');assert.equal(audio.quality,'lossless');
    await provider.mutations.likeSong(page.items[0],true);assert.deepEqual(calls.at(-1),{name:'soda.likeSong',params:{id:'001',liked:true}});
});
function providerId(){return 'folium.folium-soda-qishui.qishui'}
test('loopback media supports range, suffix, HEAD and unsatisfiable ranges',async()=>{
    const root=fs.mkdtempSync(path.join(os.tmpdir(),'folia-soda-test-'));fs.mkdirSync(path.join(root,'bin'));
    fs.copyFileSync(path.join(ROOT,'folium-soda/index.cjs'),path.join(root,'index.cjs'));
    fs.copyFileSync(path.join(ROOT,'folium-soda/signingRuntime.cjs'),path.join(root,'signingRuntime.cjs'));
    const media=path.join(root,'song.m4a');fs.writeFileSync(media,'0123456789');
    fs.writeFileSync(path.join(root,'bin/soda-bridge'),`#!/usr/bin/node\nconst r=require('node:readline').createInterface({input:process.stdin});r.on('line',l=>{const m=JSON.parse(l);console.log(JSON.stringify({id:m.id,ok:true,result:{path:${JSON.stringify(media)}}}));});\n`,{mode:0o755});
    const handlers={};const dispose=require(path.join(root,'index.cjs'))({storage:{paths:{data:root,cache:root}},rpc:{handle:(n,f)=>handlers[n]=f},log:{info(){},warn(){}}});
    try{
        const audio=await handlers['soda.getAudioUrl']({song:{id:'1'}});
        const range=await fetch(audio.url,{headers:{Range:'bytes=3-6'}});assert.equal(range.status,206);assert.equal(range.headers.get('content-range'),'bytes 3-6/10');assert.equal(await range.text(),'3456');
        const suffix=await fetch(audio.url,{headers:{Range:'bytes=-3'}});assert.equal(await suffix.text(),'789');
        const head=await fetch(audio.url,{method:'HEAD'});assert.equal(head.headers.get('content-length'),'10');assert.equal(await head.text(),'');
        assert.equal((await fetch(audio.url,{headers:{Range:'bytes=20-'}})).status,416);
    }finally{dispose();fs.rmSync(root,{recursive:true});}
});
test('runtime account hydration reads all playlist pages and clears stale anonymous state',async()=>{
    const asset=fs.readFileSync(path.join(ROOT,'host/omni-BBHqIUb8.js'),'utf8');
    const begin=asset.indexOf('async refreshProviderAccount(');const end=asset.indexOf(',invalidateActiveRequests()',begin);
    const updates=[];const persisted=[];
    const accountStore={getState:()=>({updateAccount:(id,state)=>updates.push({id,...state})})};
    const refresh=Function('L','Xt',`return ({${asset.slice(begin,end)}}).refreshProviderAccount`)(accountStore,async id=>persisted.push(id));
    let loggedIn=true;const visited=[];
    const host={getLoginStatus:async()=>loggedIn?{id:'user'}:null,getProviderUserPlaylists:async(id,user,page)=>{visited.push(page.offset);return{items:[{id:String(page.offset)}],hasMore:page.offset===0,nextOffset:100}},getProviderLikedSongIds:async()=>['track'],getProviderSummaries:()=>[{providerId:'qishui'}]};
    await refresh.call(host,'qishui');assert.deepEqual(visited,[0,100]);assert.equal(updates[0].status,'authenticated');assert.equal(updates[0].collections.length,2);assert.deepEqual(updates[0].likedSongIds,['track']);
    loggedIn=false;await refresh.call(host,'qishui');assert.equal(updates[1].status,'anonymous');assert.deepEqual(updates[1].collections,[]);assert.deepEqual(updates[1].likedSongIds,[]);assert.deepEqual(persisted,['qishui','qishui']);
});
