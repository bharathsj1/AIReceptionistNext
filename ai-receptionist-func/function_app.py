import azure.functions as func

app = func.FunctionApp()

# Import endpoint modules so their routes register with the shared app.
import receptionist_endpoints  # noqa
import booking_endpoints  # noqa
import health_endpoints  # noqa
import crawler_endpoints  # noqa
