from pathlib import Path
from database.database import get_connection
if __name__=='__main__':
 with get_connection() as db,db.cursor() as c:
  c.execute(Path(__file__).with_name('sql').joinpath('008_operations.sql').read_text())
  c.execute(Path(__file__).with_name('sql').joinpath('009_iec104.sql').read_text())
 print('IEC104 migration tamamlandı. API ve collector yeniden başlatılmalı.')
