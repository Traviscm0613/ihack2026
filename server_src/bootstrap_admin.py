import sys
import uuid
from pathlib import Path

from .config import Settings
from .db import Database
from .security import hash_password


def main():
    if len(sys.argv) != 4:
        raise SystemExit("usage: python3 -m server_src.bootstrap_admin USERNAME DISPLAY_NAME PASSWORD")
    settings = Settings()
    db = Database(settings.database_path, Path(__file__).with_name("schema.sql"))
    timestamp = __import__("datetime").datetime.now(__import__("datetime").timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")
    with db.connection() as connection:
        connection.execute("INSERT INTO users VALUES (?, ?, ?, ?, 'administrator', 1, ?, ?)", (str(uuid.uuid4()), sys.argv[1], sys.argv[2], hash_password(sys.argv[3]), timestamp, timestamp))
    print(f"Created administrator {sys.argv[1]}")


if __name__ == "__main__":
    main()

