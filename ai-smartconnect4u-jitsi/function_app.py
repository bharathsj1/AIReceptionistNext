import azure.functions as func
from dotenv import load_dotenv

# Load local .env for dev convenience (local.settings.json is handled by Functions host)
load_dotenv()

app = func.FunctionApp()


@app.route(route="health", methods=["GET"], auth_level=func.AuthLevel.ANONYMOUS)
def health(req: func.HttpRequest) -> func.HttpResponse:
    return func.HttpResponse("OK", status_code=200)

# Import routes and triggers so they register with the shared app instance.
import meetings_endpoints  # noqa: E402,F401
import process_meeting_audio  # noqa: E402,F401
