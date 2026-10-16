import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

from shared.config import get_database_url


class DatabaseConfigTests(unittest.TestCase):
    def test_development_defaults_to_sqlite(self):
        with patch.dict(os.environ, {}, clear=True):
            self.assertEqual(get_database_url(), "sqlite:///./data/app.db")

    def test_database_url_file_takes_precedence(self):
        with tempfile.TemporaryDirectory() as directory:
            secret = Path(directory) / "database_url"
            secret.write_text("postgresql+psycopg2://example.invalid/app\n", encoding="utf-8")
            with patch.dict(
                os.environ,
                {
                    "DATABASE_URL": "sqlite:///ignored.db",
                    "DATABASE_URL_FILE": str(secret),
                },
                clear=True,
            ):
                self.assertEqual(
                    get_database_url(),
                    "postgresql+psycopg2://example.invalid/app",
                )

    def test_production_rejects_sqlite(self):
        with patch.dict(
            os.environ,
            {"DATABASE_URL": "sqlite:///app.db", "REQUIRE_POSTGRES": "true"},
            clear=True,
        ):
            with self.assertRaisesRegex(ValueError, "requires a PostgreSQL"):
                get_database_url()

    def test_production_accepts_postgres_secret(self):
        with tempfile.TemporaryDirectory() as directory:
            secret = Path(directory) / "database_url"
            secret.write_text("postgresql://example.invalid/app\n", encoding="utf-8")
            with patch.dict(
                os.environ,
                {"DATABASE_URL_FILE": str(secret), "REQUIRE_POSTGRES": "true"},
                clear=True,
            ):
                self.assertEqual(
                    get_database_url(),
                    "postgresql://example.invalid/app",
                )


if __name__ == "__main__":
    unittest.main()
