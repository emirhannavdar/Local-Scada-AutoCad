"""Sample-time alarm lifecycle. Missing GOOD values never mean zero."""
import math

def step(rule, state, value, quality, at, active):
    last = state.get('last_at')
    if last is not None and at <= last:
        return {'skip': True}
    numeric = isinstance(value, (float, int)) and math.isfinite(value)
    good = quality == 'GOOD' and numeric
    bad_rule = rule['kind'] == 'BAD'
    if not bad_rule and not good:
        return {'pending_since': None, 'last_at': at, 'open': False, 'clear': False}
    if bad_rule:
        trigger = quality != 'GOOD'
        clear = quality == 'GOOD'
    elif rule['kind'] == 'HIGH':
        trigger = value > rule['threshold']
        clear = value <= rule['threshold'] - rule['hysteresis']
    else:
        trigger = value < rule['threshold']
        clear = value >= rule['threshold'] + rule['hysteresis']
    pending = state.get('pending_since')
    gap = last is None or (at-last).total_seconds() > rule['max_gap_seconds']
    if active:
        return {'pending_since': None, 'last_at': at, 'open': False, 'clear': clear}
    pending = at if trigger and (pending is None or gap) else pending if trigger else None
    opened = pending is not None and (at-pending).total_seconds() >= rule['delay_seconds']
    return {'pending_since': None if opened else pending, 'last_at': at, 'open': opened, 'clear': False}

def evaluate(cursor, row, at):
    from psycopg.rows import dict_row
    with cursor.connection.cursor(row_factory=dict_row) as c:
        c.execute('SELECT * FROM scada_alarm_rule WHERE tag_id=%s AND enabled ORDER BY id FOR UPDATE', (row.tag_id,))
        for rule in c.fetchall():
            c.execute('SELECT * FROM scada_alarm_state WHERE rule_id=%s', (rule['id'],))
            state = c.fetchone() or {}
            c.execute('SELECT id FROM scada_alarm_event WHERE rule_id=%s AND cleared_at IS NULL', (rule['id'],))
            event = c.fetchone()
            result = step(rule, state, row.deger, row.kalite, at, bool(event))
            if result.get('skip'):
                continue
            if result['clear'] and event:
                c.execute("UPDATE scada_alarm_event SET cleared_at=%s,clear_reason='NORMAL' WHERE id=%s", (at,event['id']))
            if result['open']:
                c.execute('INSERT INTO scada_alarm_event(rule_id,tag_id,rule_name,kind,severity,threshold,value,quality,started_at) VALUES(%s,%s,%s,%s,%s,%s,%s,%s,%s)', (rule['id'],row.tag_id,rule['name'],rule['kind'],rule['severity'],rule['threshold'],row.deger,row.kalite,at))
            c.execute('INSERT INTO scada_alarm_state(rule_id,pending_since,last_at) VALUES(%s,%s,%s) ON CONFLICT(rule_id) DO UPDATE SET pending_since=EXCLUDED.pending_since,last_at=EXCLUDED.last_at', (rule['id'],result['pending_since'],at))
