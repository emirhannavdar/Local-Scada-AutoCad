"""Install additive operations tables in the configured PostgreSQL database."""
from pathlib import Path
from database.database import get_connection

def main():
    sql = Path(__file__).with_name('sql').joinpath('008_operations.sql').read_text(encoding='utf-8')
    with get_connection() as connection, connection.cursor() as cursor:
        cursor.execute(sql)
    print('İşletme merkezi migration tamamlandı. API ve collector yeniden başlatılabilir.')

if __name__ == '__main__':
    main()
