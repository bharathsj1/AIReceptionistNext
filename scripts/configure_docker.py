"""Prepare persistent Docker settings without printing or rotating existing secrets."""
import argparse
from pathlib import Path
import secrets

ROOT = Path(__file__).resolve().parents[1]
SECRET_NAMES = ("AUTH_SESSION_SECRET", "SOCIAL_TOKEN_ENC_KEY", "OUTREACH_TOOL_SECRET")


def prepare(destination):
    destination = Path(destination)
    contents = destination.read_text() if destination.exists() else (ROOT / "ai-receptionist-func/.env.docker.example").read_text()
    lines = contents.splitlines()
    for name in SECRET_NAMES:
        indexes = [i for i, line in enumerate(lines) if line.strip().startswith(f"{name}=")]
        if any(lines[i].split("=", 1)[1].strip().strip("\"'") for i in indexes):
            continue
        value = f"{name}={secrets.token_urlsafe(48)}"
        if indexes:
            lines[indexes[-1]] = value
        else:
            lines.append(value)
    destination.parent.mkdir(parents=True, exist_ok=True)
    destination.write_text("\n".join(lines) + "\n")
    destination.chmod(0o600)
    return destination


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, default=ROOT / ".env.docker")
    args = parser.parse_args()
    path = prepare(args.output)
    print(f"Docker settings ready: {path}. Existing non-empty secrets were preserved.")
