use libresoda::{Soda, Song, Playlist, AppCredentials};
use libresoda::http::{self, RequestOption};
use libresoda::model::QRLoginStatus;
use libresoda::soda::{track, types, search, playlist, user_playlist, collection, crypto};
use libresoda::soda::media_ref::MediaRef;
use libresoda::soda::signature::HttpSignature;
use serde::Deserialize;
use serde_json::{json, Value};
use std::{fs, io::{self, BufRead, Write}, path::PathBuf, sync::Arc};
#[cfg(unix)] use std::os::unix::fs::OpenOptionsExt;

// JSON-lines transport for Folia's Qishui provider. Credentials stay in this process.
#[derive(Deserialize)]
struct Request { id: Value, method: String, params: Value }
type Result<T> = std::result::Result<T, Box<dyn std::error::Error>>;
fn text<'a>(v: &'a Value, key: &str) -> &'a str { v[key].as_str().unwrap_or("") }
fn number(v: &Value, key: &str, default: usize) -> usize { v[key].as_u64().map(|n|n as usize).unwrap_or(default) }
fn quality(value: &str) -> &str { match value { "standard"=>"medium", "high"=>"highest", "lossless"=>"lossless", "hires"=>"best", _=>"best" } }
fn session_file() -> PathBuf { std::env::var_os("SODA_SESSION_FILE").unwrap().into() }
fn save_session(cookie: &str) -> Result<()> {
    let target=session_file();
    let mut options=fs::OpenOptions::new(); options.write(true).create(true).truncate(true);
    #[cfg(unix)] options.mode(0o600);
    options.open(&target)?.write_all(cookie.as_bytes())?;
    Ok(())
}
fn song(s: &Song) -> Value {
    json!({"id":s.extra_get("track_id").unwrap_or(&s.id),"title":s.name,"artists":s.artist.split('/').map(str::trim).collect::<Vec<_>>(),"album":s.album,"coverUrl":s.cover,"durationMs":s.duration*1000})
}
fn track_song(t: &types::Track) -> Value {
    let mut s=song(&track::build_song_from_track(t));
    s["artistDetails"]=json!(t.artists.iter().map(|a|json!({"id":a.id,"name":a.name})).collect::<Vec<_>>());
    s["albumDetails"]=json!({"id":t.album.id,"name":t.album.name}); s
}
fn collection(p: &Playlist, kind: &str, owned: bool) -> Value {
    json!({"id":p.id,"name":p.name,"type":kind,"coverUrl":p.cover,"description":p.description,"trackCount":p.track_count,"playCount":p.play_count,"isOwned":owned,"isLiked":p.extra_get("type")==Some("1"),"providerData":{"ownerId":p.extra_get("owner_id").unwrap_or(""),"playlistType":p.extra_get("type").unwrap_or("")}})
}
fn page(items: Vec<Value>, limit: usize, offset: usize) -> Value {
    let total=items.len(); let selected=items.into_iter().skip(offset).take(limit).collect::<Vec<_>>();
    json!({"hasMore":offset+selected.len()<total,"nextOffset":offset+selected.len(),"total":total,"items":selected})
}
fn account(soda: &Soda) -> Result<Value> {
    if !!soda.cookie().is_empty() { return Ok(Value::Null) }
    let me=user_playlist::fetch_pc_me(soda)?.my_info;
    if me.id.is_empty() { return Err("汽水登录会话已失效，请重新扫码".into()) }
    Ok(json!({"id":me.id,"nickname":me.nickname,"avatarUrl":types::build_image_url(&me.larger_avatar_url,""),"vipType":if me.is_vip {1}else{0}}))
}
fn mixed(soda: &Soda, kinds: &[&str]) -> Result<Vec<collection::MixedCollectionItem>> {
    let mut items=Vec::new(); let mut cursor=String::new();
    loop {
        let response=soda.collected_mixed(&cursor,100,kinds)?;
        items.extend(collection::parse_mixed_collections(&response));
        if response["has_more"] != true { break }
        cursor=text(&response,"next_cursor").to_owned();
    }
    Ok(items)
}
fn liked(soda: &Soda) -> Result<Vec<Value>> {
    let playlists = soda.get_my_playlists("", 100)?;
    let favorite = playlists.playlists.iter().find(|p| p.extra_get("type") == Some("1"));
    match favorite {
        Some(playlist) => Ok(soda.get_playlist_songs(&playlist.id)?.iter().map(song).collect()),
        None => Ok(Vec::new()),
    }
}
// Preserve Qishui word timing in YRC, which Folia parses natively.
fn yrc(raw: &str) -> String {
    raw.lines().map(|line| {
        let Some((header,content))=line.split_once(']') else { return line.to_string() };
        let line_start=header.trim_start_matches('[').split(',').next().unwrap().parse::<i64>().unwrap_or(0);
        let relative=content.split_once('<').and_then(|(_,s)|s.split_once(',')).and_then(|(n,_)|n.parse::<i64>().ok()).map(|n|n<line_start).unwrap_or(false);
        let mut output=format!("{header}]"); let mut rest=content;
        while let Some((prefix,tagged))=rest.split_once('<') {
            output.push_str(prefix); let (tag,after)=tagged.split_once('>').unwrap();
            let mut numbers=tag.split(','); let start=numbers.next().unwrap().parse::<i64>().unwrap();
            let duration=numbers.next().unwrap();
            output.push_str(&format!("({},{duration},0)",if relative {line_start+start}else{start})); rest=after;
        }
        output.push_str(rest);
        if !content.contains('<') && !content.is_empty() {
            let duration=header.split(',').nth(1).unwrap(); return format!("{header}]({line_start},{duration},0){content}")
        }
        output
    }).collect::<Vec<_>>().join("\n")
}
fn handle(r: &Request,soda: &Soda, qr: &mut Option<String>) -> Result<Value> {
    let p=&r.params; let id=text(p,"id"); let limit=number(p,"limit",30); let offset=number(p,"offset",0);
    match r.method.as_str() {
        "diagnostics"=>Ok(json!({"bridgeVersion":env!("CARGO_PKG_VERSION"),"mode":if !soda.cookie().is_empty(){"signed-in"}else{"anonymous"},"accountLogin":true,"encryptedAudioDecryption":true,"wordLyrics":true})),
        "getAccount"=>account(soda),
        "authStatus"=>{let user=account(soda)?;Ok(json!({"loggedIn":!user.is_null(),"status":if user.is_null(){"未登录"}else{"已登录汽水音乐"},"user":user}))},
        "qrCreate"=>{let result=soda.create_qr()?; *qr=Some(result.token);Ok(json!({"qrImage":result.qr_image,"expiresAt":result.expire_time,"scanUrl":result.scan_url}))},
        "qrPoll"=>{let token=qr.as_ref().ok_or("请先生成二维码")?;let result=soda.check_qr(token)?;
            if result.status==QRLoginStatus::Success {save_session(&result.cookie)?;soda.set_cookie(result.cookie);*qr=None;}
            Ok(json!({"status":result.status.as_str(),"message":result.message,"needSecondVerify":result.extra.get("need_second_verify").map(|v|v=="true").unwrap_or(false)}))},
        "qrVerify"=>{soda.open_second_verify(qr.as_ref().ok_or("请先生成二维码")?)?;Ok(json!({"opened":true}))},
        "logout"=>{if session_file().exists(){fs::remove_file(session_file())?;}soda.set_cookie("");*qr=None;Ok(Value::Null)},
        "search"=>{
            let page=&p["page"];let count=number(page,"limit",30);let start=number(page,"offset",0);
            let url=search::android_search_url("track",text(p,"query"),1,count as i64);
            let url=url.replace("cursor=0",&format!("cursor={start}"));
            let body=http::get(&url,&[RequestOption::new().header("User-Agent",types::SODA_ANDROID_SEARCH_USER_AGENT).cookie(&soda.cookie())])?;
            let response:Value=serde_json::from_slice(&body)?;
            if response["status_code"].as_i64().unwrap_or(0)!=0 {return Err(format!("汽水搜索：{}",response["status_info"]).into())}
            let mut items=Vec::new(); let mut has_more=false;
            for group in response["result_groups"].as_array().ok_or("汽水搜索未返回结果分组")? {
                has_more |= group["has_more"]==true;
                if let Some(data)=group["data"].as_array(){for item in data {
                    let track:types::Track=serde_json::from_value(item["entity"]["track"].clone())?;
                    items.push(track_song(&track));
                }}
            }
            has_more |= items.len()>count; items.truncate(count);
            Ok(json!({"hasMore":has_more,"items":items}))
        },
        "getSong"=>{let response=track::fetch_web_track_v2(soda,id)?;Ok(track_song(&response.primary_track()))},
        "getAudioUrl"=>{
            soda.set_quality_preference(quality(text(p,"quality")));
            let info=libresoda::soda::download::resolve_download_info(soda,text(&p["song"],"id"),None)?;
            let mut value=json!({"url":info.url,"quality":info.quality,"isPreview":info.is_preview,"note":info.note,"durationMs":(info.duration*1000.0) as u64});
            if !info.play_auth.is_empty() {
                let target=PathBuf::from(std::env::var_os("SODA_CACHE_DIR").unwrap()).join(format!("{}-{}.{}",text(&p["song"],"id"),info.quality,info.format));
                if !target.exists(){let bytes=http::get(&info.url,&[])?;let audio=crypto::decrypt_audio(&bytes,&info.play_auth)?;fs::write(&target,audio)?;}
                value["path"]=json!(target);value.as_object_mut().unwrap().remove("url");
            }
            Ok(value)
        },
        "getLyrics"=>{let response=track::fetch_web_track_v2(soda,text(&p["song"],"id"))?;let raw=response.lyric.content;
            if raw.is_empty(){Ok(Value::Null)}else{Ok(json!({"main":{"format":"yrc","text":yrc(&raw)}}))}},
        "getUserPlaylists"=>{
            let mut items=Vec::new();let mut cursor=String::new();
            loop {let result=soda.get_my_playlists(&cursor,100)?;items.extend(result.playlists.iter().map(|v|collection(v,"playlist",true)));if !result.has_more{break}cursor=result.next_cursor;}
            items.extend(mixed(soda,&["playlist"])?.iter().map(|m|json!({"id":m.id(),"name":m.title(),"type":"playlist","coverUrl":m.cover_url(),"isOwned":false})));
            Ok(page(items,limit,offset))
        },
        "getUserAlbums"=>Ok(page(mixed(soda,&["album"])?.iter().map(|m|json!({"id":m.id(),"name":m.title(),"type":"album","coverUrl":m.cover_url()})).collect(),limit,offset)),
        "getLikedSongs"=>Ok(json!(liked(soda)?)),
        "getPlaylist"=>{let (p,tracks)=playlist::fetch_playlist_detail(soda,id)?;Ok(json!({"collection":collection(&p,"playlist",false),"songs":tracks.iter().map(song).collect::<Vec<_>>()}))},
        "getAlbum"=>{let(p,tracks)=libresoda::soda::album::fetch_album_detail(soda,id)?;Ok(json!({"collection":collection(&p,"album",false),"songs":tracks.iter().map(song).collect::<Vec<_>>()}))},
        "getRecommendedCollections"=>Ok(json!(soda.get_recommend_playlists()?.iter().take(limit).map(|p|collection(p,"playlist",false)).collect::<Vec<_>>())),
        "likeSong"=>{let media=[MediaRef::track(id)];if p["liked"]==true{soda.collect_media(&media)?;}else{soda.uncollect_media(&media)?;}Ok(Value::Null)},
        "updatePlaylistTracks"=>{let media=p["ids"].as_array().unwrap().iter().map(|v|MediaRef::track(v.as_str().unwrap())).collect::<Vec<_>>();if p["operation"]=="add"{soda.append_playlist_media(id,&media)?;}else{soda.delete_playlist_media(id,&media)?;}Ok(Value::Null)},
        "subscribePlaylist"=>{if p["subscribed"]==true{soda.collect_playlists(&[id.into()])?;}else{soda.uncollect_playlists(&[id.into()])?;}Ok(Value::Null)},
        "subscribeAlbum"=>{if p["subscribed"]==true{soda.collect_albums(&[id.into()])?;}else{soda.uncollect_albums(&[id.into()])?;}Ok(Value::Null)},
        _=>Err(format!("未知汽水方法：{}",r.method).into())
    }
}
fn main() -> Result<()> {
    let soda=Soda::new("");soda.enable_cdp_signer();
    if session_file().exists(){soda.set_cookie(fs::read_to_string(session_file())?);}
    if let Some(path)=std::env::var_os("SODA_APP_CREDENTIALS"){soda.set_app_credentials(serde_json::from_slice::<AppCredentials>(&fs::read(path)?)?);}
    if let Some(signer)=HttpSignature::from_env(){soda.set_signature_provider(Arc::new(signer));}
    let mut qr=None;let mut out=io::stdout().lock();
    for line in io::stdin().lock().lines(){let r:Request=serde_json::from_str(&line?)?;
        let response=match handle(&r,&soda,&mut qr){Ok(result)=>json!({"id":r.id,"ok":true,"result":result}),Err(error)=>json!({"id":r.id,"ok":false,"error":{"message":error.to_string()}})};
        writeln!(out,"{response}")?;out.flush()?;
    }
    Ok(())
}
#[cfg(test)] mod tests {
    use super::*;
    #[test] fn yrc_keeps_absolute_word_times(){assert_eq!(yrc("[1000,700]<1000,200>你<1200,500>好"),"[1000,700](1000,200,0)你(1200,500,0)好");}
    #[test] fn yrc_translates_relative_word_times(){assert_eq!(yrc("[1000,700]<0,200>你<200,500>好"),"[1000,700](1000,200,0)你(1200,500,0)好");}
    #[test] fn yrc_retains_line_only_lyrics(){assert_eq!(yrc("[1000,700]你好"),"[1000,700](1000,700,0)你好");}
    #[test] fn pages_use_offset(){let r=page(vec![json!(1),json!(2),json!(3)],1,1);assert_eq!(r["items"],json!([2]));assert_eq!(r["nextOffset"],2);assert_eq!(r["hasMore"],true);}
}
