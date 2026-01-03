import os
import sys


def main() -> int:
    conn_str = "DefaultEndpointsProtocol=https;AccountName=smartconnect4u;AccountKey=+rRQ8JG/hWkbmnwlZ+N7QTI32cBId3wNaVCW3hT3XG0MIdxvqADr/Q/03U+C6f7LVJzDVs56T4Mg+AStQWfm0w==;EndpointSuffix=core.windows.net"
    if not conn_str:
        print("Missing AZURE_STORAGE_CONNECTION_STRING", file=sys.stderr)
        return 1
    table_name = os.getenv("TASK_EVENTS_TABLE", "taskevents")
    try:
        from azure.data.tables import TableServiceClient
        from azure.core.exceptions import ResourceExistsError
    except Exception as exc:
        print(f"Missing azure-data-tables dependency: {exc}", file=sys.stderr)
        return 1
    try:
        service = TableServiceClient.from_connection_string(conn_str)
        table = service.get_table_client(table_name)
        try:
            table.create_table()
        except ResourceExistsError:
            pass
        print(f"OK: table '{table_name}' is ready.")
        return 0
    except Exception as exc:
        print(f"Failed to create table '{table_name}': {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
