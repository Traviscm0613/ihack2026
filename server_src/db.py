from contextlib import contextmanager
from pathlib import Path
import sqlite3


class Database:
    def __init__(self, path: Path, schema_path: Path):
        self.path = path
        self.schema_path = schema_path
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self.initialize()

    @contextmanager
    def connection(self):
        connection = sqlite3.connect(self.path)
        connection.row_factory = sqlite3.Row
        connection.execute("PRAGMA foreign_keys = ON")
        connection.execute("PRAGMA journal_mode = WAL")
        try:
            yield connection
            connection.commit()
        except Exception:
            connection.rollback()
            raise
        finally:
            connection.close()

    def initialize(self):
        with self.connection() as connection:
            connection.executescript(self.schema_path.read_text(encoding="utf-8"))
            # Keep databases created by the initial prototype compatible with
            # the complete grading API without requiring a destructive reset.
            columns = {row["name"] for row in connection.execute("PRAGMA table_info(submissions)")}
            if "graded_at" not in columns:
                connection.execute("ALTER TABLE submissions ADD COLUMN graded_at TEXT")
            if "graded_by" not in columns:
                connection.execute("ALTER TABLE submissions ADD COLUMN graded_by TEXT")

    @staticmethod
    def row(row):
        return dict(row) if row else None

