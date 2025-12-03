import json
import os

import requests


def main() -> None:
    """Call the local Ultravox agents endpoint and print IDs and names."""
    base_url = os.getenv("FUNCTION_BASE_URL", "http://localhost:7071")
    limit = os.getenv("AGENT_LIST_LIMIT", "20")
    url = f"{base_url.rstrip('/')}/api/ultravox/agents"
    params = {"limit": limit}

    response = requests.get(url, params=params, timeout=20)
    print(f"Status: {response.status_code}")
    try:
        data = response.json()
    except ValueError:
        print("Non-JSON response:")
        print(response.text)
        return

    if response.status_code >= 300:
        print("Error response:")
        print(json.dumps(data, indent=2))
        return

    agents = data.get("agents") or []
    print("Agents:")
    for agent in agents:
        print(f"- {agent.get('id') or agent.get('agentId')}: {agent.get('name')}")


if __name__ == "__main__":
    main()
