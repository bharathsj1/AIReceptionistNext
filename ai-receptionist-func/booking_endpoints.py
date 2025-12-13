import logging

import azure.functions as func
from function_app import app
from utils.cors import build_cors_headers


@app.function_name(name="BookingApi")
@app.route(route="booking", methods=["GET", "POST", "OPTIONS"], auth_level=func.AuthLevel.ANONYMOUS)
def booking_api(req: func.HttpRequest) -> func.HttpResponse:
    logging.info("Booking endpoint called.")

    cors = build_cors_headers(req, ["GET", "POST", "OPTIONS"])
    if req.method == "OPTIONS":
        return func.HttpResponse("", status_code=204, headers=cors)

    try:
        body = req.get_json()
    except ValueError:
        body = {}

    name = (body or {}).get("name") or req.params.get("name") or "Guest"
    time = (body or {}).get("time") or req.params.get("time") or "unspecified"

    reply = f"Booking received for {name} at {time}"
    return func.HttpResponse(reply, status_code=200, headers=cors)
