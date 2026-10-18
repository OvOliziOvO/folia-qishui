import { loadConfig } from './src/config.mjs';
import { BdmsSigner } from './src/bdms.mjs';
import { createServer } from './src/server.mjs';

// Folia owns this loopback signer and starts it on an available port.
const config = loadConfig();
const signer = new BdmsSigner({ modulePath: config.bdmsModule, deviceId: config.deviceId });
const server = createServer({ config, signer });
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
console.log(JSON.stringify({ event: 'ready', url: `http://127.0.0.1:${server.address().port}` }));
process.on('SIGTERM', () => server.close(() => process.exit(0)));
