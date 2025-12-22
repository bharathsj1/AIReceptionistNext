import unittest
from datetime import datetime

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from shared.db import Base, CallMessage
from services.call_service import (
    upsert_call,
    attach_ultravox_call,
    store_call_messages,
    mark_call_ended,
    resolve_call,
)


class CallServiceTests(unittest.TestCase):
    def setUp(self):
        self.engine = create_engine("sqlite:///:memory:", future=True)
        Base.metadata.create_all(bind=self.engine)
        Session = sessionmaker(bind=self.engine)
        self.db = Session()

    def tearDown(self):
        self.db.close()
        self.engine.dispose()

    def test_upsert_call_mapping(self):
        call = upsert_call(self.db, "CA123", "+15551234567", "+14445556666", "initiated")
        self.db.commit()
        call2 = upsert_call(self.db, "CA123", None, "+14445556666", "in_progress")
        self.db.commit()
        self.assertEqual(call.id, call2.id)
        self.assertEqual(call2.status, "in_progress")
        updated = attach_ultravox_call(self.db, "CA123", "uvx_call_1")
        self.db.commit()
        self.assertEqual(updated.ultravox_call_id, "uvx_call_1")

    def test_store_messages_idempotent(self):
        call = upsert_call(self.db, "CA999", "+15550001111", "+14440002222", "initiated")
        self.db.commit()
        messages = [
            {"role": "user", "text": "Hi there", "timestamp": "2024-01-01T10:00:00Z"},
            {"role": "agent", "text": "Hello! How can I help?", "timestamp": "2024-01-01T10:00:02Z"},
        ]
        store_call_messages(self.db, call, messages)
        self.db.commit()
        first_count = self.db.query(CallMessage).count()
        store_call_messages(self.db, call, messages)
        self.db.commit()
        self.assertEqual(self.db.query(CallMessage).count(), first_count)

    def test_mark_call_ended(self):
        call = upsert_call(self.db, "CA777", "+15550009999", "+14440005555", "in_progress")
        ended_at = datetime(2024, 1, 1, 12, 0, 0)
        mark_call_ended(self.db, call, ended_at)
        self.db.commit()
        self.assertEqual(call.status, "ended")
        self.assertEqual(call.ended_at, ended_at)
        call.ultravox_call_id = "uvx_call_777"
        self.db.commit()
        resolved = resolve_call(self.db, "uvx_call_777", None)
        self.assertIsNotNone(resolved)


if __name__ == "__main__":
    unittest.main()
