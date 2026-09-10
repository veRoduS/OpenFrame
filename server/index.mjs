import { createApp } from './app.mjs';
import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const project = fileURLToPath(new URL('..', import.meta.url));
const { app, db } = createApp();
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
  console.log(`OpenFrame: http://localhost:${port}`),
);
function stop() {
  server.close(() => {
    db.close();
    process.exit(0);
  });
}
process.on('SIGTERM', stop);
process.on('SIGINT', stop);
