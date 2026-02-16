import unittest

from services.crm_store import (
    create_entity,
    list_entities,
    reset_memory_store_for_tests,
    upsert_task_indexes,
    lookup_task_ids_by_index,
)


class CrmTenantIsolationTests(unittest.TestCase):
    def setUp(self):
        reset_memory_store_for_tests()

    def test_partition_isolation_for_tasks(self):
        task_a = create_entity("tasks", "tenant-a", {"title": "A task", "status": "new"})
        task_b = create_entity("tasks", "tenant-b", {"title": "B task", "status": "new"})

        list_a, _ = list_entities("tasks", "tenant-a", limit=20)
        list_b, _ = list_entities("tasks", "tenant-b", limit=20)

        ids_a = {item["id"] for item in list_a}
        ids_b = {item["id"] for item in list_b}
        self.assertIn(task_a["id"], ids_a)
        self.assertNotIn(task_b["id"], ids_a)
        self.assertIn(task_b["id"], ids_b)
        self.assertNotIn(task_a["id"], ids_b)

    def test_indexes_are_tenant_scoped(self):
        task_one = create_entity(
            "tasks",
            "tenant-a",
            {
                "title": "Follow up lead",
                "status": "new",
                "assignedToEmail": "owner@a.com",
                "dueDate": "2026-02-20T00:00:00Z",
                "priority": "high",
            },
        )
        task_two = create_entity(
            "tasks",
            "tenant-b",
            {
                "title": "Other tenant lead",
                "status": "new",
                "assignedToEmail": "owner@a.com",
                "dueDate": "2026-02-20T00:00:00Z",
                "priority": "high",
            },
        )
        upsert_task_indexes("tenant-a", task_one)
        upsert_task_indexes("tenant-b", task_two)

        ids_a = lookup_task_ids_by_index("tenant-a", assignee_email="owner@a.com")
        ids_b = lookup_task_ids_by_index("tenant-b", assignee_email="owner@a.com")

        self.assertEqual(ids_a, {task_one["id"]})
        self.assertEqual(ids_b, {task_two["id"]})


if __name__ == "__main__":
    unittest.main()

