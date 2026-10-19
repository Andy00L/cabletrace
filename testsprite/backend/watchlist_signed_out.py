# TestSprite backend test: /api/watchlist refuses a signed-out reader and a change sent from another site.
# Route: src/app/api/watchlist/route.ts (the user id only ever comes from the Clerk session).
# Runs top to bottom in TestSprite's Python sandbox (standard library plus requests); the calls at the end run it.
import requests

BASE_URL = "https://cabletrace.vercel.app"
REQUEST_TIMEOUT_SECONDS = 30


def test_signed_out_reader_gets_401() -> None:
    response = requests.get(f"{BASE_URL}/api/watchlist", timeout=REQUEST_TIMEOUT_SECONDS)
    assert response.status_code == 401, f"expected 401, got {response.status_code}"
    assert response.json() == {"error": "signed-out"}, response.text
    assert response.headers.get("cache-control") == "no-store", response.headers.get("cache-control")
    print("[test_signed_out_reader_gets_401] 401 signed-out")


def test_cross_origin_change_gets_403() -> None:
    response = requests.post(
        f"{BASE_URL}/api/watchlist",
        json={"kind": "case", "ref": "eagle-s-2024", "label": "Eagle S anchor drag"},
        headers={"Origin": "https://another-site.example"},
        timeout=REQUEST_TIMEOUT_SECONDS,
    )
    assert response.status_code == 403, f"expected 403, got {response.status_code}"
    assert response.json() == {"error": "cross-origin"}, response.text
    print("[test_cross_origin_change_gets_403] 403 cross-origin")


test_signed_out_reader_gets_401()
test_cross_origin_change_gets_403()
