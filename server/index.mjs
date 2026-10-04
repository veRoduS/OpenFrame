import { createApp } from './app.mjs';
import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const project = fileURLToPath(new URL('..', import.meta.url));
const { app, db, close, seedInitialAdmin } = createApp();
const initialAdmin = seedInitialAdmin();
if (initialAdmin) {
  console.log('OpenFrame: created a unique admin for this installation.');
  console.log(`Username: ${initialAdmin.username}`);
  console.log(`Initial password: ${initialAdmin.password}`);
  console.log(
    'Store this password securely. Change it under Users & Groups > My password. It will not be printed again.',
  );
}
app.use('/player', express.static(path.join(project, 'player/web')));
if (process.argv.includes('--dev')) {
  const { createServer } = await import('vite');
  const vite = await createServer({
    server: { middlewareMode: true },
    appType: 'spa',
  });
  app.use(vite.middlewares);
} else {
  app.use(express.static(path.join(project, 'dist')));
  app.get('/{*path}', (req, res) =>
    res.sendFile(path.join(project, 'dist/index.html')),
  );
}
const port = Number(process.env.PORT || 3100);
const server = app.listen(port, process.env.HOST || '0.0.0.0', () =>
  console.log(`OpenFrame: http://localhost:${server.address().port}`),
);
function stop() {
  close();
  server.close(() => {
    db.close();
    process.exit(0);
  });
}
process.on('SIGTERM', stop);
process.on('SIGINT', stop);
