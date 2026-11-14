from dataclasses import dataclass
from pathlib import Path
import os


@dataclass(frozen=True)
class Settings:
    host: str = os.getenv("LOCALLEARN_HOST", "0.0.0.0")
    port: int = int(os.getenv("LOCALLEARN_PORT", "8080"))
    data_dir: Path = Path(os.getenv("LOCALLEARN_DATA_DIR", "./server_data"))
    max_upload_bytes: int = int(os.getenv("LOCALLEARN_MAX_UPLOAD_BYTES", str(25 * 1024 * 1024)))

    @property
    def database_path(self) -> Path:
        return self.data_dir / "locallearn.sqlite3"

    @property
    def files_dir(self) -> Path:
        return self.data_dir / "files"

