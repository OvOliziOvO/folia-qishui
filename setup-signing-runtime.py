#!/usr/bin/env python3
import argparse
import hashlib
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import urllib.request
import zipfile

# Install official components locally; they are never included in the mod/source ZIP.
NODE_URL = 'https://nodejs.org/dist/v20.18.0/node-v20.18.0-win-x64.zip'
NODE_SHA = 'f5cea43414cc33024bbe5867f208d1c9c915d6a38e92abeee07ed9e563662297'
QISHUI_URL = 'https://lf-luna-release.qishui.com/obj/luna-release/3.7.0/452316191/SodaMusic-v3.7.0-official-win32_x64.exe'
QISHUI_SHA = 'e58578aec410e2c9c24835e92a1dc74d0fda982be1cf1003034538255baab0e4'
parser = argparse.ArgumentParser()
parser.add_argument('--node-archive', type=Path)
parser.add_argument('--qishui-installer', type=Path)
parser.add_argument('--data-dir', type=Path, default=Path.home()/'.config/Folia/mods-data/folium-soda-qishui/files/signing-runtime')
args = parser.parse_args()
runtime = args.data_dir.resolve()
runtime.mkdir(parents=True, exist_ok=True)
with tempfile.TemporaryDirectory(prefix='soda-runtime-') as temp:
    stage = Path(temp)
    def artifact(existing, url, checksum, name):
        file = existing or stage/name
        if not existing:
            urllib.request.urlretrieve(url, file)
        if hashlib.sha256(file.read_bytes()).hexdigest() != checksum:
            raise ValueError(f'{name}: SHA-256 mismatch')
        return file
    node = artifact(args.node_archive, NODE_URL, NODE_SHA, 'node.zip')
    client = artifact(args.qishui_installer, QISHUI_URL, QISHUI_SHA, 'qishui.exe')
    with zipfile.ZipFile(node) as archive:
        (runtime/'node.exe').write_bytes(archive.read('node-v20.18.0-win-x64/node.exe'))
    subprocess.run(['7z','x','-y',f'-o{stage/"client"}',str(client)], check=True, stdout=subprocess.DEVNULL)
    app = next((stage/'client').rglob('app.7z'))
    subprocess.run(['7z','e','-y',f'-o{runtime}',str(app),'resources/app.asar.unpacked/bdms.node','resources/app.asar.unpacked/metasecml.dll'], check=True, stdout=subprocess.DEVNULL)
    env = {**os.environ, 'WINEPREFIX':str(runtime/'wine-prefix'), 'WINEDEBUG':'-all', 'WINEDLLOVERRIDES':'mscoree,mshtml='}
    subprocess.run(['wineboot','-u'], env=env, check=True)
print('汽水本机签名组件已安装。重载 Folia 汽水模组后生效。')
