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
            connection.execute('CREATE TABLE IF NOT EXISTS schema_migrations (version TEXT PRIMARY KEY, applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)')
            connection.execute("INSERT OR IGNORE INTO schema_migrations(version) VALUES ('001_initial_schema')")
            for migration in sorted((self.schema_path.parent / 'migrations').glob('*.sql')):
                if connection.execute('SELECT version FROM schema_migrations WHERE version=?', (migration.stem,)).fetchone(): continue
                connection.executescript(migration.read_text(encoding='utf-8'))
                connection.execute('INSERT INTO schema_migrations(version) VALUES (?)', (migration.stem,))
            connection.execute('PRAGMA user_version = 3')

    @staticmethod
    def row(row):
        return dict(row) if row else None

