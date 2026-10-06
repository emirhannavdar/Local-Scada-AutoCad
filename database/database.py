import os
import psycopg
from psycopg.types.json import Json
from config import (
    DB_HOST,
    DB_PORT,
    DB_NAME,
    DB_USER,
    DB_PASSWORD
)

def get_connection():
    return psycopg.connect(
        host=os.getenv("DB_HOST", DB_HOST),
        port=os.getenv("DB_PORT", DB_PORT),
        dbname=os.getenv("DB_NAME", DB_NAME),
        user=os.getenv("DB_USER", DB_USER),
        password=os.getenv("DB_PASSWORD", DB_PASSWORD)
    )

def save_measurement(device_id, data):
    connection = get_connection()
    try:
        cursor = connection.cursor()

        cursor.execute(
            """
            INSERT INTO measurements (device_id, data)
            VALUES (%s, %s)
            """,
            (
                device_id,
                Json(data)
            )
        )

        connection.commit()

    finally:
        connection.close()