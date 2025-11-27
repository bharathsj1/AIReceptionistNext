def save_dummy_record(data: dict) -> None:
    # In real code this would save to a database
    print(f"[DB] Saving dummy record: {data}")


def get_dummy_record(record_id: str) -> dict:
    # In real code this would load from a database
    return {"id": record_id, "status": "dummy", "note": "This is a fake record"}
