/**
 * SQLite journal (single writer, WAL). The table stores the exact body bytes that were hashed,
 * so verification never re-encodes. On open, rows are loaded into the in-memory read path.
 */
import Database from 'better-sqlite3';
import { MemoryJournal, type RawRow } from '@me/engine-core';
import type { JournalRecord, RecordDraft, RecordKind } from '@me/schema';

const SCHEMA = `
CREATE TABLE IF NOT EXISTS records (
  seq          INTEGER PRIMARY KEY,
  ingest_time  INTEGER NOT NULL,
  kind         TEXT    NOT NULL,
  record_id    TEXT    NOT NULL UNIQUE,
  body         BLOB    NOT NULL,
  prev_hash    TEXT    NOT NULL,
  hash         TEXT    NOT NULL
);
CREATE INDEX IF NOT EXISTS records_ingest ON records(ingest_time);
CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS checkpoints (
  seq        INTEGER PRIMARY KEY,
  t          INTEGER NOT NULL,
  root       TEXT    NOT NULL,
  signer     TEXT    NOT NULL,
  signature  TEXT    NOT NULL
);
`;

export class SqliteJournal extends MemoryJournal {
  readonly db: Database.Database;
  private insert: Database.Statement;

  constructor(path: string, opts: { readonly?: boolean } = {}) {
    super();
    this.db = new Database(path, { readonly: !!opts.readonly });
    if (!opts.readonly) {
      this.db.pragma('journal_mode = WAL');
      this.db.pragma('synchronous = NORMAL');
      this.db.exec(SCHEMA);
    }
    this.insert = this.db.prepare(
      'INSERT INTO records (seq, ingest_time, kind, record_id, body, prev_hash, hash) VALUES (?, ?, ?, ?, ?, ?, ?)',
    );
    this.loadFromDisk();
  }

  private loadFromDisk(): void {
    const stmt = this.db.prepare('SELECT seq, ingest_time, kind, record_id, body, prev_hash, hash FROM records ORDER BY seq');
    const rows = stmt.iterate() as IterableIterator<{
      seq: number;
      ingest_time: number;
      kind: string;
      record_id: string;
      body: Buffer;
      prev_hash: string;
      hash: string;
    }>;
    this.loadRows(
      (function* () {
        for (const r of rows) {
          const row: RawRow = {
            seq: r.seq,
            ingest_time: r.ingest_time,
            kind: r.kind as RecordKind,
            record_id: r.record_id,
            body: new Uint8Array(r.body.buffer, r.body.byteOffset, r.body.byteLength),
            prev_hash: r.prev_hash,
            hash: r.hash,
          };
          yield row;
        }
      })(),
    );
  }

  override append(drafts: RecordDraft[]): JournalRecord[] {
    const { records, rows } = this.prepare(drafts);
    const tx = this.db.transaction((rs: RawRow[]) => {
      for (const r of rs) this.insert.run(r.seq, r.ingest_time, r.kind, r.record_id, r.body, r.prev_hash, r.hash);
    });
    tx(rows);
    for (const r of rows) this.push(r);
    return records;
  }

  setMeta(key: string, value: unknown): void {
    this.db.prepare('INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(
      key,
      JSON.stringify(value),
    );
  }

  getMeta<T>(key: string): T | undefined {
    const row = this.db.prepare('SELECT value FROM meta WHERE key = ?').get(key) as { value: string } | undefined;
    return row ? (JSON.parse(row.value) as T) : undefined;
  }

  close(): void {
    this.db.close();
  }
}
