import unittest

from services.crm_rbac import (
    can_create_contact,
    can_create_deal,
    can_create_task,
    can_patch_task,
    can_view_task,
    normalize_role,
)


class CrmRbacTests(unittest.TestCase):
    def test_primary_scope_maps_to_admin(self):
        self.assertEqual(normalize_role(None, "primary_user"), "admin")

    def test_client_admin_maps_to_member(self):
        self.assertEqual(normalize_role("admin", "client_user"), "member")

    def test_member_view_rules(self):
        task = {
            "assignedToEmail": "assignee@example.com",
            "watchers": ["watcher@example.com"],
            "collaborators": ["collab@example.com"],
        }
        self.assertTrue(can_view_task("member", "assignee@example.com", task))
        self.assertFalse(can_view_task("member", "watcher@example.com", task))
        self.assertFalse(can_view_task("member", "outsider@example.com", task))

    def test_member_can_reassign_task(self):
        before = {"assignedToEmail": "member@example.com", "watchers": []}
        allowed, reason = can_patch_task(
            "member",
            "member@example.com",
            before,
            {"assignedToEmail": "other@example.com"},
        )
        self.assertTrue(allowed)
        self.assertIsNone(reason)

    def test_member_can_update_progress_when_assigned(self):
        before = {"assignedToEmail": "member@example.com", "watchers": []}
        allowed, reason = can_patch_task(
            "member",
            "member@example.com",
            before,
            {"status": "in_progress", "progressPercent": 65},
        )
        self.assertTrue(allowed)
        self.assertIsNone(reason)

    def test_member_status_update_allows_system_fields(self):
        before = {"assignedToEmail": "member@example.com", "watchers": []}
        allowed, reason = can_patch_task(
            "member",
            "member@example.com",
            before,
            {
                "status": "completed",
                "progressPercent": 100,
                "updatedAt": "2026-02-16T00:00:00Z",
                "completedAt": "2026-02-16T00:00:00Z",
            },
        )
        self.assertTrue(allowed)
        self.assertIsNone(reason)

    def test_member_can_create_tasks_and_deals(self):
        self.assertTrue(can_create_task("member"))
        self.assertTrue(can_create_deal("member"))
        self.assertTrue(can_create_contact("member"))


if __name__ == "__main__":
    unittest.main()
