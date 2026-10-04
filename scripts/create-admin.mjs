import { randomBytes } from 'node:crypto';
import { createApp } from '../server/app.mjs';
import { createAccounts } from '../server/accounts.mjs';

// Credentials are emitted once for the operator, never written to source files.
const instance = createApp();
try {
  const accounts = createAccounts(instance.db);
  const password = randomBytes(24).toString('base64url');
  const user = accounts.createUser({
    username: process.argv[2] || 'admin',
    name: 'Administrator',
    password,
    role: 'admin',
  });
  console.log(JSON.stringify({ username: user.username, password }));
} finally {
  instance.close();
  instance.db.close();
}
