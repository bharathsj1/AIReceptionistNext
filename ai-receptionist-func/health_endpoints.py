import azure.functions as func
from function_app import app
from utils.cors import build_cors_headers


@app.function_name(name="HealthApi")
@app.route(route="health", methods=["GET", "OPTIONS"], auth_level=func.AuthLevel.ANONYMOUS)
def health_api(req: func.HttpRequest) -> func.HttpResponse:  # pylint: disable=unused-argument
    cors = build_cors_headers(req, ["GET", "OPTIONS"])
    if req.method == "OPTIONS":
        return func.HttpResponse("", status_code=204, headers=cors)
    return func.HttpResponse("OK", status_code=200, headers=cors)
