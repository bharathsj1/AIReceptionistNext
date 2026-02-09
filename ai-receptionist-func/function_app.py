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
import prompt_endpoints  # noqa
import prompt_registry_endpoints  # noqa
import auth_endpoints  # noqa
import dashboard_endpoints  # noqa
import ultravox_demo_endpoints  # noqa
import stripe_payment_endpoints  # noqa
import call_endpoints  # noqa
import email_endpoints  # noqa
import contacts_endpoints  # noqa
import social_endpoints  # noqa
import social_ai_caption  # noqa
import task_manager_endpoints  # noqa
import tasks_create  # noqa
import tasks_list  # noqa
import tasks_detail  # noqa
import tasks_accept  # noqa
import tasks_reject  # noqa
import tasks_stream  # noqa
import tasks_changes  # noqa
import contact_message_endpoints  # noqa
import chat  # noqa
