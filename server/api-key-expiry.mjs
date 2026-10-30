import { z } from 'zod';

export const expiryDays = z.number().int().min(1).max(365).nullable();
export const keyExpiry = (days) =>
  days === null ? null : new Date(Date.now() + days * 86400000).toISOString();

// SQLite cannot drop a NOT NULL constraint in place. Preserve every column,
// credential digest and index when upgrading the original key tables.
export function migrateKeyExpiry(db, table) {
  if (!['data_feed_tokens', 'data_feed_application_tokens'].includes(table))
    throw new Error('Unknown API-key table');
  const columns = db.prepare(`PRAGMA table_info(${table})`).all();
  if (!columns.find((column) => column.name === 'expiresAt')?.notnull) return;
  const original = db
    .prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name=?")
    .get(table).sql;
  const indexes = db
    .prepare(
      "SELECT sql FROM sqlite_master WHERE type='index' AND tbl_name=? AND sql IS NOT NULL",
    )
    .all(table);
  const temporary = `${table}_expiry_upgrade`;
  const definition = original
    .replace(
      /^CREATE TABLE\s+(?:IF NOT EXISTS\s+)?\S+/i,
      `CREATE TABLE ${temporary}`,
    )
    .replace(/expiresAt\s+TEXT\s+NOT\s+NULL/i, 'expiresAt TEXT');
  const names = columns.map((column) => `"${column.name}"`).join(',');
  db.exec('SAVEPOINT key_expiry_migration');
  try {
    db.exec(definition);
    db.exec(`INSERT INTO ${temporary} (${names}) SELECT ${names} FROM ${table};
      DROP TABLE ${table}; ALTER TABLE ${temporary} RENAME TO ${table};`);
    for (const index of indexes) db.exec(index.sql);
    db.exec('RELEASE key_expiry_migration');
  } catch (error) {
    db.exec('ROLLBACK TO key_expiry_migration; RELEASE key_expiry_migration');
    throw error;
  }
}
