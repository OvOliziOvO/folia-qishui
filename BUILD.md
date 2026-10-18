# 安装与构建

适用于 Folia 0.7.20 / Linux x86_64；需要 Rust、Node.js、Python 3、Wine、wineboot、script 和 7z。

## 构建

```bash
cargo test --locked --manifest-path bridge/Cargo.toml
cargo build --release --locked --manifest-path bridge/Cargo.toml
mkdir -p folium-soda/bin
cp bridge/target/release/folium-soda-bridge folium-soda/bin/soda-bridge
node --test tests/contracts.test.cjs
```

## 安装

退出 Folia，备份原版 `/opt/Folia/resources/app.asar` 及已有汽水模组，再应用宿主补丁：

```bash
python3 host/patch_asar.py /opt/Folia/resources/app.asar app-patched.asar host/experimental-Bz6ZgOKz.js
sudo install -m 644 app-patched.asar /opt/Folia/resources/app.asar
mkdir -p "$HOME/.config/Folia/mods/folium-soda-qishui"
cp -a folium-soda/. "$HOME/.config/Folia/mods/folium-soda-qishui/"
python3 setup-signing-runtime.py
```

运行时脚本下载固定版本的官方汽水和 Windows Node 组件，校验 SHA-256 后安装至本机模组数据目录；独立 Wine 环境约占 1.3 GB。已有下载文件可通过 `--node-archive` 和 `--qishui-installer` 传入。

启动 Folia，在原有模组确认窗口启用「汽水音乐」，然后打开「汽水账号」扫码登录。

本版包含宿主补丁；Folia 官方升级后需要重新适配。整曲和音质取决于汽水账号权限与上游返回结果。

## 卸载

退出 Folia，恢复备份的原版 `app.asar`，在模组管理中移除汽水模组。账号数据目录为 `~/.config/Folia/mods-data/folium-soda-qishui/`。
