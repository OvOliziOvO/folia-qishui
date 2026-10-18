#!/usr/bin/env python3
import hashlib
import json
import pathlib
import struct
import sys

# Repack Folia 0.7.20 with the Omni extension, keeping ASAR offsets and integrity valid.
def patch(source, target, replacement):
    source, target = pathlib.Path(source), pathlib.Path(target)
    data = source.read_bytes()
    _, header_size, _, length = struct.unpack('<4I', data[:16])
    header = json.loads(data[16:16 + length])
    entries = []
    replacements = {'/dist/assets/' + p.name: p.read_bytes() for p in pathlib.Path(replacement).parent.glob('*.js')}
    def walk(tree, prefix=''):
        for name, item in tree['files'].items():
            path = f'{prefix}/{name}'
            if 'files' in item:
                walk(item, path)
            elif 'offset' in item and not item.get('unpacked'):
                entries.append((int(item['offset']), path, item))
    walk(header)
    payload = bytearray()
    replaced = False
    for offset, path, entry in sorted(entries):
        content = data[8 + header_size + offset:8 + header_size + offset + entry['size']]
        if path in replacements:
            content = replacements[path]
            block_size = 4 * 1024 * 1024
            entry['integrity'] = {'algorithm': 'SHA256', 'hash': hashlib.sha256(content).hexdigest(), 'blockSize': block_size, 'blocks': [hashlib.sha256(content[i:i+block_size]).hexdigest() for i in range(0, len(content), block_size)]}
            replaced = True
        entry['offset'], entry['size'] = str(len(payload)), len(content)
        payload.extend(content)
    if not replaced:
        raise ValueError('Folia 0.7.20 experimental asset was not found')
    encoded = json.dumps(header, separators=(',', ':'), ensure_ascii=False).encode()
    size = (8 + len(encoded) + 3) // 4 * 4
    target.write_bytes(struct.pack('<4I', 4, size, size - 4, len(encoded)) + encoded + bytes(size - 8 - len(encoded)) + payload)

if __name__ == '__main__':
    patch(*sys.argv[1:])
