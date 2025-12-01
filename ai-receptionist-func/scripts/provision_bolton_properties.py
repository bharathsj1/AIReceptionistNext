import json

import requests


def main() -> None:
    """Provision Bolton Properties through the local Functions endpoint and print key fields."""
    url = "http://localhost:7071/api/clients/provision"
    payload = {
        "email": "info@boltonproperties.co.uk",
        "website_url": "https://www.boltonproperties.co.uk/",
    }

    response = requests.post(url, json=payload, timeout=30)
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

    print("Provisioned client:")
    print(json.dumps(
        {
            "client_id": data.get("client_id"),
            "email": data.get("email"),
            "website_url": data.get("website_url"),
            "name": data.get("name"),
            "ultravox_agent_id": data.get("ultravox_agent_id"),
            "phone_number": data.get("phone_number"),
            "twilio_sid": data.get("twilio_sid"),
        },
        indent=2,
    ))


if __name__ == "__main__":
    main()
