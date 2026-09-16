import { randomBytes } from 'node:crypto';

export function mountRecovery(app, { admin, player, get, put, remove, vault }) {
  const recordId = (id) => `recovery:${id}`;
  function settings(device) {
    const id = recordId(device.id);
    let record = get('recovery-wifi', id);
    if (!record) {
      const value = {
        playerId: device.id,
        ssid: device.id.replaceAll('-', ''),
        password: randomBytes(18).toString('base64url'),
        hidden: true,
      };
      record = put('recovery-wifi', {
        id,
        encrypted: vault.encrypt(value, id),
      });
    }
    return vault.decrypt(record);
  }
  app.post('/api/player/recovery', player, (req, res) => {
    if (!req.device.approved)
      return res.status(403).json({ error: 'Approve this screen first' });
    res.set('Cache-Control', 'no-store').json(settings(req.device));
  });
  app.get('/api/devices/:id/recovery', admin, (req, res) => {
    const device = get('device', req.params.id);
    if (!device) return res.status(404).json({ error: 'Screen not found' });
    const record = get('recovery-wifi', recordId(device.id));
    res
      .set('Cache-Control', 'no-store')
      .json(
        record && device.approved
          ? { available: true, ...vault.decrypt(record) }
          : { available: false },
      );
  });
  return { remove: (id) => remove('recovery-wifi', recordId(id)) };
}
