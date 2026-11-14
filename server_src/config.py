from dataclasses import dataclass
from pathlib import Path
import os


@dataclass(frozen=True)
class Settings:
    host: str = os.getenv("LOCALLEARN_HOST", "0.0.0.0")
    # Port 8080 is already used by the Pi's gameboard service.
    port: int = int(os.getenv("LOCALLEARN_PORT", "8090"))
    data_dir: Path = Path(os.getenv("LOCALLEARN_DATA_DIR", "./server_data"))
    max_upload_bytes: int = int(os.getenv("LOCALLEARN_MAX_UPLOAD_BYTES", str(25 * 1024 * 1024)))

    @property
    def database_path(self) -> Path:
        return self.data_dir / "locallearn.sqlite3"

    @property
    def files_dir(self) -> Path:
        return self.data_dir / "files"

