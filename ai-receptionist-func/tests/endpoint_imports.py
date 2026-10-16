"""Replace only the app registration target, keeping imported dependencies intact."""
import sys
from contextlib import contextmanager


@contextmanager
def function_app_module(fake):
    previous = sys.modules.get('function_app')
    sys.modules['function_app'] = fake
    try:
        yield
    finally:
        if previous is None:
            sys.modules.pop('function_app', None)
        else:
            sys.modules['function_app'] = previous
