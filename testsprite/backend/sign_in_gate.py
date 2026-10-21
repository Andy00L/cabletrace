# TestSprite backend test: the sign-in gate (src/proxy.ts). Only the front page and /api/health answer a signed-out
# caller; every API refuses it with 401 and the gate's own message, and every other page or file is closed to it.
# Runs top to bottom in TestSprite's Python sandbox (standard library plus requests); the calls at the end run it.
import requests

BASE_URL = "https://cabletrace.vercel.app"
REQUEST_TIMEOUT_SECONDS = 30
# sourceRef: the 401 body written by src/proxy.ts for an API call without a session.
GATE_MESSAGE = {"error": "Sign in to read this."}
# A browser's page request, which the gate answers with a redirect toward sign-in instead of a 404.
DOCUMENT_HEADERS = {"Accept": "text/html", "Sec-Fetch-Dest": "document"}


def test_public_routes_answer_signed_out() -> None:
    front_page = requests.get(f"{BASE_URL}/", timeout=REQUEST_TIMEOUT_SECONDS)
    assert front_page.status_code == 200, f"front page answered {front_page.status_code}"
    health = requests.get(f"{BASE_URL}/api/health", timeout=REQUEST_TIMEOUT_SECONDS)
    assert health.status_code == 200, f"/api/health answered {health.status_code}"
    # Whether the recorders write is health_endpoint.py's question; here it only has to answer signed out.
    assert "status" in health.json(), health.text
    print("[test_public_routes_answer_signed_out] front page and health answer 200")


def test_apis_refuse_signed_out() -> None:
    for path in ("/api/watchlist", "/api/ship-frames/index.json"):
        response = requests.get(f"{BASE_URL}{path}", timeout=REQUEST_TIMEOUT_SECONDS)
        assert response.status_code == 401, f"{path} answered {response.status_code}"
        assert response.json() == GATE_MESSAGE, f"{path}: {response.text}"
    change = requests.post(f"{BASE_URL}/api/watchlist", json={"kind": "case", "ref": "eagle-s-2024", "label": "Eagle S"}, timeout=REQUEST_TIMEOUT_SECONDS)
    assert change.status_code == 401, f"a signed-out change answered {change.status_code}"
    print("[test_apis_refuse_signed_out] watchlist and ship frames refused with 401")


def test_pages_and_files_closed_signed_out() -> None:
    case_file = requests.get(f"{BASE_URL}/cases/eagle-s-2024/case-file", timeout=REQUEST_TIMEOUT_SECONDS)
    assert case_file.status_code == 404, f"the case file answered {case_file.status_code} signed out"
    for path in ("/cases/eagle-s-2024", "/live"):
        page = requests.get(f"{BASE_URL}{path}", headers=DOCUMENT_HEADERS, allow_redirects=False, timeout=REQUEST_TIMEOUT_SECONDS)
        assert page.status_code in (302, 307), f"{path} answered {page.status_code} instead of a redirect"
        location = page.headers.get("location", "")
        # The gate sends the reader to sign in and back to this exact page afterwards (src/proxy.ts, next=).
        assert location.startswith("/sign-in?next=") or "/sign-in?next=" in location, location
    print("[test_pages_and_files_closed_signed_out] case file 404, pages redirect toward sign-in")


test_public_routes_answer_signed_out()
test_apis_refuse_signed_out()
test_pages_and_files_closed_signed_out()
