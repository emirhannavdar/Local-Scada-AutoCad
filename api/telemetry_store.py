"""Atomic history/live write with replay receipts and acquisition timestamps."""
import hashlib
import json
from datetime import datetime, timezone
from fastapi import HTTPException
from api.alarm_engine import evaluate

def store(rows, batch_id=None):
    from database.database import get_connection
    if not rows:
        return {'count': 0, 'duplicate': False}
    now = datetime.now(timezone.utc)
    digest = hashlib.sha256(json.dumps([r.model_dump(mode='json') for r in rows],sort_keys=True,separators=(',',':')).encode()).hexdigest()
    with get_connection() as db, db.cursor() as c:
        c.execute("SELECT to_regclass('scada_measurement_clock')")
        if c.fetchone()[0] is None:
            raise HTTPException(503,'İşletme merkezi migration eksik. install_operations.py çalıştırın.')
        if batch_id:
            c.execute('INSERT INTO scada_ingest_receipt(id,payload_hash,row_count) VALUES(%s,%s,%s) ON CONFLICT DO NOTHING RETURNING id', (batch_id,digest,len(rows)))
            if not c.fetchone():
                c.execute('SELECT payload_hash FROM scada_ingest_receipt WHERE id=%s',(batch_id,))
                if c.fetchone()[0] != digest:
                    raise HTTPException(409,'Bu batch ID farklı bir içerikle kullanılmış.')
                return {'count': len(rows), 'duplicate': True}
        # Consistent lock order across simultaneous device groups.
        for tag_id in sorted({r.tag_id for r in rows}):
            c.execute('SELECT id FROM tag WHERE id=%s FOR UPDATE',(tag_id,))
            if not c.fetchone():
                raise HTTPException(422,f'Tag {tag_id} bulunamadı; tampon kaydı korunur.')
        for row in sorted(rows,key=lambda r: (r.sampled_at or now,r.tag_id)):
            at = row.sampled_at or now
            if row.protocol_meta is not None:
                from psycopg.types.json import Jsonb
                c.execute('INSERT INTO olcum_gecmis(zaman,tag_id,deger,deger_text,kalite,protocol_meta) VALUES(%s,%s,%s,%s,%s,%s)',(at,row.tag_id,row.deger,row.deger_text,row.kalite,Jsonb(row.protocol_meta)))
            else:
                c.execute('INSERT INTO olcum_gecmis(zaman,tag_id,deger,deger_text,kalite) VALUES(%s,%s,%s,%s,%s)',(at,row.tag_id,row.deger,row.deger_text,row.kalite))
            c.execute('SELECT sampled_at FROM scada_measurement_clock WHERE tag_id=%s',(row.tag_id,))
            clock = c.fetchone()
            if not clock:
                c.execute('SELECT updated_at,zaman FROM olcum_anlik WHERE tag_id=%s',(row.tag_id,))
                old=c.fetchone()
                last = max((x.replace(tzinfo=timezone.utc) if x.tzinfo is None else x for x in old if x is not None),default=None) if old else None
            else:
                last=clock[0]
            if last is not None and at <= last:
                continue
            c.execute('''INSERT INTO olcum_anlik(tag_id,zaman,deger,deger_text,kalite,updated_at)
              VALUES(%s,%s,%s,%s,%s,NOW()) ON CONFLICT(tag_id) DO UPDATE SET
              zaman=CASE WHEN EXCLUDED.deger IS NULL AND EXCLUDED.deger_text IS NULL THEN olcum_anlik.zaman ELSE EXCLUDED.zaman END,
              deger=CASE WHEN EXCLUDED.deger IS NULL AND EXCLUDED.deger_text IS NULL THEN olcum_anlik.deger ELSE EXCLUDED.deger END,
              deger_text=CASE WHEN EXCLUDED.deger IS NULL AND EXCLUDED.deger_text IS NULL THEN olcum_anlik.deger_text ELSE EXCLUDED.deger_text END,
              kalite=EXCLUDED.kalite,updated_at=NOW()''',(row.tag_id,at,row.deger,row.deger_text,row.kalite))
            c.execute('INSERT INTO scada_measurement_clock(tag_id,sampled_at) VALUES(%s,%s) ON CONFLICT(tag_id) DO UPDATE SET sampled_at=EXCLUDED.sampled_at',(row.tag_id,at))
            evaluate(c,row,at)
    return {'count':len(rows),'duplicate':False}
