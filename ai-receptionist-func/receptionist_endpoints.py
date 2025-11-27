import logging
import azure.functions as func
from function_app import app


@app.function_name(name="ReceptionistApi")
@app.route(route="receptionist", auth_level=func.AuthLevel.ANONYMOUS)
def receptionist_api(req: func.HttpRequest) -> func.HttpResponse:
    logging.info("Receptionist endpoint called.")

    try:
        body = req.get_json()
    except ValueError:
        body = {}

    message = (body or {}).get("message") or req.params.get("message")

    if not message:
        return func.HttpResponse("Send me a 'message'.", status_code=200)

    reply = f"AI Receptionist Response: {message}"
    return func.HttpResponse(reply, status_code=200)
