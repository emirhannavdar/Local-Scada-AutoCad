"""Durable measurement outbox. Commands are never queued here."""
import json
import os
import sqlite3
import threading
import time
import uuid
from pathlib import Path

class BufferFull(RuntimeError):pass

class Outbox:
    def __init__(self,path,scope,max_rows=250000):
        self.path=Path(path);self.path.parent.mkdir(parents=True,exist_ok=True)
        self.scope=scope;self.max_rows=max_rows;self.lock=threading.RLock()
        with self.connect() as c:
            c.execute('PRAGMA journal_mode=WAL')
            c.execute('CREATE TABLE IF NOT EXISTS batches(id TEXT PRIMARY KEY,scope TEXT NOT NULL,payload TEXT NOT NULL,rows INTEGER NOT NULL,created REAL NOT NULL,status TEXT NOT NULL DEFAULT "pending",error TEXT)')
            c.execute('CREATE INDEX IF NOT EXISTS batches_pending ON batches(scope,status,created)')
            c.execute('CREATE TABLE IF NOT EXISTS cache(scope TEXT PRIMARY KEY,payload TEXT NOT NULL,at REAL NOT NULL)')
        try:os.chmod(self.path,0o600)
        except OSError:pass
    def connect(self):
        c=sqlite3.connect(self.path,timeout=15);c.row_factory=sqlite3.Row
        return c
    def enqueue(self,rows):
        if not rows:return 0
        batches=[]
        for offset in range(0,len(rows),500):
            chunk=rows[offset:offset+500];id=str(uuid.uuid4())
            payload=json.dumps({'batch_id':id,'rows':chunk},allow_nan=False,separators=(',',':'))
            batches.append((id,self.scope,payload,len(chunk),time.time()))
        with self.lock,self.connect() as c:
            c.execute('BEGIN IMMEDIATE')
            # Limit includes all scopes and rejected batches; no silent deletions.
            used=c.execute('SELECT COALESCE(sum(rows),0) FROM batches').fetchone()[0]
            if used+len(rows)>self.max_rows:raise BufferFull('Tampon dolu. Aktarım veya reddedilen kayıtları inceleyin; ölçümler silinmedi.')
            c.executemany('INSERT INTO batches(id,scope,payload,rows,created) VALUES(?,?,?,?,?)',batches)
        return len(rows)
    def peek(self):
        with self.lock,self.connect() as c:
            r=c.execute('SELECT * FROM batches WHERE scope=? AND status="pending" ORDER BY created,rowid LIMIT 1',(self.scope,)).fetchone()
            return dict(r) if r else None
    def delivered(self,id):
        with self.lock,self.connect() as c:c.execute('DELETE FROM batches WHERE id=? AND scope=?',(id,self.scope))
    def reject(self,id,error):
        with self.lock,self.connect() as c:c.execute('UPDATE batches SET status="rejected",error=? WHERE id=? AND scope=?',(str(error)[:300],id,self.scope))
    def retry_rejected(self):
        with self.lock,self.connect() as c:return c.execute('UPDATE batches SET status="pending",error=NULL WHERE scope=? AND status="rejected"',(self.scope,)).rowcount
    def stats(self):
        with self.lock,self.connect() as c:
            r=c.execute('SELECT count(*) AS queue_batches,COALESCE(sum(rows),0) AS queue_rows,COALESCE(sum(length(payload)),0) AS queue_bytes,COALESCE(sum(CASE WHEN status="rejected" THEN 1 ELSE 0 END),0) AS rejected_batches FROM batches WHERE scope=?',(self.scope,)).fetchone()
            return dict(r)
    def save_cache(self,configs):
        with self.lock,self.connect() as c:c.execute('INSERT INTO cache(scope,payload,at) VALUES(?,?,?) ON CONFLICT(scope) DO UPDATE SET payload=excluded.payload,at=excluded.at',(self.scope,json.dumps(list(configs.values()),default=str),time.time()))
    def cache_age(self):
        with self.lock,self.connect() as c:r=c.execute('SELECT at FROM cache WHERE scope=?',(self.scope,)).fetchone()
        return time.time()-r[0] if r else float("inf")
    def load_cache(self,max_age):
        with self.lock,self.connect() as c:r=c.execute('SELECT payload,at FROM cache WHERE scope=?',(self.scope,)).fetchone()
        if not r or time.time()-r['at']>max_age:return None
        return {(x['device']['id'],x['group']['id']):x for x in json.loads(r['payload'])}
