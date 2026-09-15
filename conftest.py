import pathlib
import sys

# The Cloudflare worker runs with ``backend/`` as its import root (entry.py does
# ``from app import app``), so backend modules import each other by bare name
# (e.g. ``from petstore_spec import ...``). Put ``backend/`` on sys.path so the
# test suite can import the app the same way the worker does.
sys.path.insert(0, str(pathlib.Path(__file__).parent / "backend"))
