import os
import unittest
from datetime import datetime, timedelta

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from shared.db import (
    Base,
    Client,
    SocialConnection,
    SocialConversation,
    SocialMessage,
    SocialPostDraft,
    SocialScheduledPost,
    User,
)
from social_endpoints import _fetch_conversations, _fetch_due_posts, _store_message, meta_webhook
from utils.token_crypto import decrypt_token, encrypt_token


class DummyRequest:
    def __init__(self, method, params=None):
        self.method = method
        self.params = params or {}
        self.headers = {}
        self.route_params = {}

    def get_json(self):
        raise ValueError()


class SocialModuleTests(unittest.TestCase):
    def setUp(self):
        self.engine = create_engine("sqlite:///:memory:", future=True)
        Base.metadata.create_all(bind=self.engine)
        Session = sessionmaker(bind=self.engine)
        self.db = Session()

        self.user = User(email="test@example.com", password_hash="hash")
        self.db.add(self.user)
        self.db.flush()
        self.client = Client(email="test@example.com", website_url="https://example.com", user_id=self.user.id)
        self.db.add(self.client)
        self.db.flush()
        self.connection = SocialConnection(
            business_id=self.client.id,
            platform="meta",
            external_account_id="page_1",
            display_name="Test Page",
            access_token_enc="enc",
            status="connected",
        )
        self.db.add(self.connection)
        self.db.flush()
        self.conversation = SocialConversation(
            business_id=self.client.id,
            platform="facebook",
            connection_id=self.connection.id,
            external_conversation_id="cust_1",
            last_message_text="Hi",
            last_message_at=datetime.utcnow(),
        )
        self.db.add(self.conversation)
        self.db.commit()

    def tearDown(self):
        self.db.close()
        self.engine.dispose()

    def test_token_encryption_roundtrip(self):
        os.environ["SOCIAL_TOKEN_ENC_KEY"] = "test-key"
        token = "secret-token-123"
        encrypted = encrypt_token(token)
        decrypted = decrypt_token(encrypted)
        self.assertNotEqual(encrypted, token)
        self.assertEqual(decrypted, token)

    def test_webhook_verification(self):
        os.environ["META_VERIFY_TOKEN"] = "verify-me"
        req = DummyRequest(
            "GET",
            params={
                "hub.mode": "subscribe",
                "hub.verify_token": "verify-me",
                "hub.challenge": "challenge123",
            },
        )
        resp = meta_webhook(req)
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.get_body().decode("utf-8"), "challenge123")

    def test_message_idempotency(self):
        first = _store_message(
            self.db,
            conversation_id=self.conversation.id,
            platform="facebook",
            external_message_id="m_1",
            direction="inbound",
            sender_type="customer",
            text="Hello",
            attachments=None,
            message_ts=datetime.utcnow(),
        )
        second = _store_message(
            self.db,
            conversation_id=self.conversation.id,
            platform="facebook",
            external_message_id="m_1",
            direction="inbound",
            sender_type="customer",
            text="Hello",
            attachments=None,
            message_ts=datetime.utcnow(),
        )
        self.db.commit()
        count = (
            self.db.query(SocialMessage)
            .filter_by(platform="facebook", external_message_id="m_1")
            .count()
        )
        self.assertTrue(first)
        self.assertFalse(second)
        self.assertEqual(count, 1)

    def test_conversation_list_ordering(self):
        older = SocialConversation(
            business_id=self.client.id,
            platform="facebook",
            connection_id=self.connection.id,
            external_conversation_id="cust_older",
            last_message_text="Old",
            last_message_at=datetime.utcnow() - timedelta(days=1),
        )
        newer = SocialConversation(
            business_id=self.client.id,
            platform="facebook",
            connection_id=self.connection.id,
            external_conversation_id="cust_new",
            last_message_text="New",
            last_message_at=datetime.utcnow(),
        )
        self.db.add_all([older, newer])
        self.db.commit()
        results = _fetch_conversations(self.db, self.client.id, 10, None)
        self.assertEqual(results[0].external_conversation_id, "cust_new")

    def test_scheduler_picks_due_once(self):
        draft = SocialPostDraft(
            business_id=self.client.id,
            caption="Hello world",
            media_urls_json=[],
            created_by_user_id=self.user.id,
        )
        self.db.add(draft)
        self.db.flush()
        scheduled = SocialScheduledPost(
            business_id=self.client.id,
            draft_id=draft.id,
            platform_targets_json={"facebook_page_id": "page_1"},
            scheduled_for=datetime.utcnow() - timedelta(minutes=1),
            status="scheduled",
        )
        self.db.add(scheduled)
        self.db.commit()

        due = _fetch_due_posts(self.db, limit=5)
        self.db.commit()
        self.assertEqual(len(due), 1)
        self.assertEqual(due[0].status, "publishing")

        due_again = _fetch_due_posts(self.db, limit=5)
        self.db.commit()
        self.assertEqual(len(due_again), 0)


if __name__ == "__main__":
    unittest.main()
