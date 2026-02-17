import unittest
from datetime import datetime

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from services.receptionist_usage_service import (
    billable_minutes_from_seconds,
    build_receptionist_usage_summary,
    collect_subscription_emails_for_client,
    compute_billing_cycle_window,
)
from shared.db import Base, Call, Client, ClientUser, PhoneNumber, Subscription, User


class ReceptionistUsageServiceTests(unittest.TestCase):
    def setUp(self):
        self.engine = create_engine("sqlite:///:memory:", future=True)
        Base.metadata.create_all(bind=self.engine)
        Session = sessionmaker(bind=self.engine)
        self.db = Session()

    def tearDown(self):
        self.db.close()
        self.engine.dispose()

    def test_billable_minutes_rounds_up(self):
        self.assertEqual(billable_minutes_from_seconds(130), 3)
        self.assertEqual(billable_minutes_from_seconds(120), 2)
        self.assertEqual(billable_minutes_from_seconds(59), 1)
        self.assertEqual(billable_minutes_from_seconds(0), 0)
        self.assertEqual(billable_minutes_from_seconds(-10), 0)

    def test_billing_cycle_window_anchors_to_subscription_day(self):
        anchor = datetime(2026, 1, 31, 10, 15, 0)
        now = datetime(2026, 2, 20, 9, 0, 0)
        cycle_start, cycle_end = compute_billing_cycle_window(anchor, now=now)

        self.assertEqual(cycle_start, datetime(2026, 1, 31, 0, 0, 0))
        self.assertEqual(cycle_end, datetime(2026, 2, 28, 0, 0, 0))

    def test_usage_summary_counts_only_current_cycle(self):
        owner = User(email="owner@example.com", password_hash="hash")
        self.db.add(owner)
        self.db.flush()

        client = Client(email="owner@example.com", website_url="https://example.com", user_id=owner.id)
        self.db.add(client)
        self.db.flush()

        self.db.add(
            ClientUser(
                client_id=client.id,
                email="member@example.com",
                password_hash="hash",
                role="user",
                status="active",
                is_active=True,
            )
        )
        self.db.add(
            PhoneNumber(
                client_id=client.id,
                twilio_phone_number="+15550001111",
                twilio_sid="PN123",
                is_active=True,
            )
        )
        self.db.add(
            Subscription(
                email="owner@example.com",
                tool="ai_receptionist",
                plan_id="bronze",
                price_id="price_1",
                stripe_customer_id="cus_1",
                stripe_subscription_id="sub_1",
                status="active",
                created_at=datetime(2026, 1, 10, 9, 0, 0),
                updated_at=datetime(2026, 1, 10, 9, 0, 0),
            )
        )
        self.db.flush()

        self.db.add_all(
            [
                Call(
                    twilio_call_sid="CA_1",
                    ai_phone_number="+15550001111",
                    status="ended",
                    started_at=datetime(2026, 1, 12, 10, 0, 0),
                    ended_at=datetime(2026, 1, 12, 10, 2, 10),
                ),
                Call(
                    twilio_call_sid="CA_2",
                    ai_phone_number="+15550001111",
                    status="ended",
                    started_at=datetime(2026, 1, 20, 8, 0, 0),
                    ended_at=datetime(2026, 1, 20, 8, 0, 59),
                ),
                Call(
                    twilio_call_sid="CA_3",
                    ai_phone_number="+15550001111",
                    status="ended",
                    started_at=datetime(2026, 2, 12, 12, 0, 0),
                    ended_at=datetime(2026, 2, 12, 12, 2, 0),
                ),
                Call(
                    twilio_call_sid="CA_4",
                    ai_phone_number="+15550001111",
                    status="ended",
                    started_at=datetime(2026, 2, 10, 0, 1, 0),
                    ended_at=datetime(2026, 2, 10, 0, 1, 20),
                ),
            ]
        )
        self.db.commit()

        emails = collect_subscription_emails_for_client(self.db, client, include_email="member@example.com")
        usage = build_receptionist_usage_summary(
            self.db,
            client,
            emails,
            now=datetime(2026, 2, 5, 9, 0, 0),
        )

        self.assertIsNotNone(usage)
        self.assertEqual(usage["planId"], "bronze")
        self.assertEqual(usage["includedMinutes"], 500)
        self.assertEqual(usage["usedMinutes"], 4)
        self.assertEqual(usage["remainingMinutes"], 496)
        self.assertFalse(usage["limitReached"])
        self.assertEqual(usage["cycleStart"], "2026-01-10T00:00:00")
        self.assertEqual(usage["cycleEnd"], "2026-02-10T00:00:00")
        self.assertEqual(usage["cycleStartDate"], "2026-01-10")
        self.assertEqual(usage["cycleEndDate"], "2026-02-10")


if __name__ == "__main__":
    unittest.main()
