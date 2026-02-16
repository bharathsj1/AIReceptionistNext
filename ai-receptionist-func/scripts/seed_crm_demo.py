#!/usr/bin/env python3
from __future__ import annotations

import argparse
from datetime import datetime, timedelta, timezone

from services.crm_store import create_entity, upsert_task_indexes, write_audit_event


def utc_iso(days_offset: int = 0) -> str:
    dt = datetime.now(timezone.utc) + timedelta(days=days_offset)
    return dt.isoformat().replace("+00:00", "Z")


def seed_tenant(tenant_id: str, owner_email: str) -> None:
    company = create_entity(
        "companies",
        tenant_id,
        {
            "name": "Acme Labs",
            "domain": "acmelabs.example",
            "industry": "Software",
            "ownerEmail": owner_email,
            "tags": ["priority"],
        },
    )

    contact_a = create_entity(
        "contacts",
        tenant_id,
        {
            "name": "John Buyer",
            "email": "john.buyer@example.com",
            "phone": "+1 555 000 1101",
            "companyId": company["id"],
            "company": company["name"],
            "leadSource": "website",
            "lifecycleStage": "qualified",
            "ownerEmail": owner_email,
            "tags": ["enterprise", "hot"],
        },
    )
    contact_b = create_entity(
        "contacts",
        tenant_id,
        {
            "name": "Maria Ops",
            "email": "maria.ops@example.com",
            "phone": "+1 555 000 2202",
            "companyId": company["id"],
            "company": company["name"],
            "leadSource": "referral",
            "lifecycleStage": "lead",
            "ownerEmail": owner_email,
            "tags": ["operations"],
        },
    )

    deal = create_entity(
        "deals",
        tenant_id,
        {
            "name": "Acme Q2 Rollout",
            "stage": "proposal",
            "value": 75000,
            "expectedCloseDate": utc_iso(21),
            "ownerEmail": owner_email,
            "contactIds": [contact_a["id"], contact_b["id"]],
            "companyId": company["id"],
            "nextAction": "Review proposal with finance team",
        },
    )

    tasks = [
        {
            "title": "Prepare proposal deck",
            "description": "Build pricing + rollout plan deck for Acme.",
            "status": "in_progress",
            "priority": "high",
            "progressPercent": 55,
            "dueDate": utc_iso(3),
            "assignedToEmail": owner_email,
            "watchers": [owner_email],
            "tags": ["proposal", "q2"],
            "relatedContactId": contact_a["id"],
            "relatedDealId": deal["id"],
            "relatedCompanyId": company["id"],
            "createdByEmail": owner_email,
        },
        {
            "title": "Schedule technical discovery call",
            "description": "Coordinate calendars and book discovery call.",
            "status": "new",
            "priority": "med",
            "progressPercent": 0,
            "dueDate": utc_iso(5),
            "assignedToEmail": owner_email,
            "watchers": [owner_email],
            "tags": ["discovery"],
            "relatedContactId": contact_b["id"],
            "relatedDealId": deal["id"],
            "relatedCompanyId": company["id"],
            "createdByEmail": owner_email,
        },
    ]

    for task_payload in tasks:
        task = create_entity("tasks", tenant_id, task_payload)
        upsert_task_indexes(tenant_id, task)
        create_entity(
            "activities",
            tenant_id,
            {
                "type": "note",
                "entityType": "task",
                "entityId": task["id"],
                "title": "Seed activity",
                "description": f"Initial task created: {task['title']}",
                "createdByEmail": owner_email,
            },
        )
        create_entity(
            "comments",
            tenant_id,
            {
                "entityType": "task",
                "entityId": task["id"],
                "text": "Seed comment for demo timeline.",
                "mentions": [],
                "createdByEmail": owner_email,
            },
        )
        write_audit_event(
            tenant_id,
            actor_email=owner_email,
            actor_user_id=None,
            actor_role="admin",
            entity_type="task",
            entity_id=task["id"],
            action="seed_created",
            before=None,
            after=task,
            meta={"source": "seed_crm_demo"},
        )

    print(f"Seeded CRM demo data for tenant {tenant_id}")


def main() -> None:
    parser = argparse.ArgumentParser(description="Seed CRM demo data for a tenant")
    parser.add_argument("--tenant-id", required=True, help="Tenant/client id (PartitionKey)")
    parser.add_argument("--owner-email", required=True, help="Tenant owner email")
    args = parser.parse_args()
    seed_tenant(args.tenant_id, args.owner_email)


if __name__ == "__main__":
    main()

