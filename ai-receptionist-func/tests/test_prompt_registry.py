import unittest

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from shared.db import Base, Client
from shared.prompt_registry import (
    compute_source_data_hash,
    create_prompt_version,
    get_active_prompt,
)
from services.prompt_registry_service import resolve_prompt_for_call


class PromptRegistryTests(unittest.TestCase):
    def setUp(self):
        self.engine = create_engine("sqlite:///:memory:", future=True)
        Base.metadata.create_all(bind=self.engine)
        Session = sessionmaker(bind=self.engine)
        self.db = Session()
        client = Client(email="test@example.com", website_url="https://example.com")
        self.db.add(client)
        self.db.commit()
        self.client_id = client.id

    def tearDown(self):
        self.db.close()
        self.engine.dispose()

    def test_source_data_hash_stability(self):
        profile = {"business_name": "Acme", "business_summary": "Test"}
        knowledge = "Some knowledge text."
        hash_one = compute_source_data_hash("Retail", "Store", "LEAD", profile, knowledge)
        hash_two = compute_source_data_hash("Retail", "Store", "LEAD", profile, knowledge)
        self.assertEqual(hash_one, hash_two)
        hash_three = compute_source_data_hash("Retail", "Store", "LEAD", profile, "Different")
        self.assertNotEqual(hash_one, hash_three)

    def test_version_incrementing(self):
        record_one = create_prompt_version(
            self.db,
            client_id=self.client_id,
            category="Retail",
            sub_type="Store",
            task_type=None,
            prompt_text="Prompt v1",
            prompt_hash="hash1",
            source_data_hash="source1",
            created_by="system",
        )
        record_two = create_prompt_version(
            self.db,
            client_id=self.client_id,
            category="Retail",
            sub_type="Store",
            task_type=None,
            prompt_text="Prompt v2",
            prompt_hash="hash2",
            source_data_hash="source2",
            created_by="system",
        )
        self.assertEqual(record_one.version, 1)
        self.assertEqual(record_two.version, 2)

    def test_active_prompt_lookup_fallback(self):
        create_prompt_version(
            self.db,
            client_id=self.client_id,
            category="Retail",
            sub_type="Store",
            task_type=None,
            prompt_text="Default prompt",
            prompt_hash="hash_default",
            source_data_hash="source_default",
            created_by="system",
        )
        create_prompt_version(
            self.db,
            client_id=self.client_id,
            category="Retail",
            sub_type="Store",
            task_type="BOOKING",
            prompt_text="Booking prompt",
            prompt_hash="hash_booking",
            source_data_hash="source_booking",
            created_by="system",
        )
        booking_prompt = get_active_prompt(self.db, self.client_id, "Store", "BOOKING")
        self.assertIsNotNone(booking_prompt)
        self.assertEqual(booking_prompt.task_type, "BOOKING")
        fallback_prompt = get_active_prompt(self.db, self.client_id, "Store", "LEAD")
        self.assertIsNotNone(fallback_prompt)
        self.assertIsNone(fallback_prompt.task_type)

    def test_router_fallback_when_missing_prompt(self):
        prompt = resolve_prompt_for_call(
            self.db,
            client_id=self.client_id,
            category="Retail",
            sub_type="Store",
            task_type="LEAD",
        )
        self.assertIsNone(prompt)


if __name__ == "__main__":
    unittest.main()
