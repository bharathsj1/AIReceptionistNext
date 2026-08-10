import azure.functions as func

from shared.db import init_db

init_db()

app = func.FunctionApp()

import vedora_endpoints  # noqa
