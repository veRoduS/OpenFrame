// Disposable real API used by PlayerAgentIntegrationTest; never a live installation.
import { createInterface } from 'node:readline';
import { createApp } from '../../server/app.mjs';

if (!process.argv[2])
  throw new Error('Provide an isolated test data directory');
const instance = createApp({ dataDir: process.argv[2] });
const server = instance.app.listen(0, '127.0.0.1');
await new Promise((resolve) => server.once('listening', resolve));
console.log(`http://127.0.0.1:${server.address().port}`);
const input = createInterface({ input: process.stdin });
input.on('line', (command) => {
  const devices = instance.db
    .prepare("SELECT body FROM records WHERE kind='device'")
    .all()
    .map((row) => JSON.parse(row.body));
  if (command === 'approve') {
    for (const device of devices) {
      device.approved = true;
      instance.db
        .prepare("UPDATE records SET body=? WHERE kind='device' AND id=?")
        .run(JSON.stringify(device), device.id);
    }
  }
  console.log(JSON.stringify({ count: devices.length }));
});
function close() {
  instance.close();
  server.close(() => {
    instance.db.close();
    process.exit(0);
  });
}
input.once('close', close);
process.once('SIGTERM', close);
