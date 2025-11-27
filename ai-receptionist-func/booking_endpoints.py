import logging
import azure.functions as func
from function_app import app


@app.function_name(name="BookingApi")
@app.route(route="booking", auth_level=func.AuthLevel.ANONYMOUS)
def booking_api(req: func.HttpRequest) -> func.HttpResponse:
    logging.info("Booking endpoint called.")

    try:
        body = req.get_json()
    except ValueError:
        body = {}

    name = (body or {}).get("name") or req.params.get("name") or "Guest"
    time = (body or {}).get("time") or req.params.get("time") or "unspecified"

    reply = f"Booking received for {name} at {time}"
    return func.HttpResponse(reply, status_code=200)
