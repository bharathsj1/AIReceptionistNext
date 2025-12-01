import azure.functions as func

from shared.db import init_db  # 👈 import this

# Initialize the database (creates tables if they don't exist)
init_db()  # 👈 this runs once when Functions host starts

app = func.FunctionApp()

# Import endpoint modules so their routes register with the shared app.
import receptionist_endpoints  # noqa
import booking_endpoints  # noqa
import health_endpoints  # noqa
import crawler_endpoints  # noqa
import onboarding_endpoints  # noqa
