import azure.functions as func
from function_app import app


@app.function_name(name="HealthApi")
@app.route(route="health", auth_level=func.AuthLevel.ANONYMOUS)
def health_api(req: func.HttpRequest) -> func.HttpResponse:  # pylint: disable=unused-argument
    return func.HttpResponse("OK", status_code=200)
