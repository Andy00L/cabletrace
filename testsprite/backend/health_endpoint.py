# TestSprite backend test: GET /api/health answers whenever the app is up, says whether both recorders write, and
# refuses a query string (each one would be a new CDN cache key reaching Supabase). Route: src/app/api/health/route.ts.
# Runs top to bottom in TestSprite's Python sandbox (standard library plus requests); the calls at the end run it.
import requests

BASE_URL = "https://cabletrace.vercel.app"
# Seconds a request may take: a cold function reads Supabase three times.
REQUEST_TIMEOUT_SECONDS = 30
RECORDER_STATES = {"recording", "failing", "stale", "never-ran", "unreachable"}


def test_health_reports_the_recorders() -> None:
    response = requests.get(f"{BASE_URL}/api/health", timeout=REQUEST_TIMEOUT_SECONDS)
    assert response.status_code == 200, f"expected 200, got {response.status_code}"
    assert response.headers.get("content-type", "").startswith("application/json"), response.headers.get("content-type")
    health = response.json()
    assert health["app"] == "up", health
    assert health["status"] in {"ok", "degraded"}, health["status"]
    assert health["recorder"]["state"] in RECORDER_STATES, health["recorder"]
    assert isinstance(health["collector"]["state"], str), health["collector"]
    assert isinstance(health["crossSource"], (list, dict)), health["crossSource"]
    if health["status"] == "ok":
        assert health["recorder"]["state"] == "recording" and health["collector"]["state"] == "collecting", health
    print(f"[test_health_reports_the_recorders] status {health['status']}, recorder {health['recorder']['state']}")


def test_health_refuses_a_query_string() -> None:
    response = requests.get(f"{BASE_URL}/api/health", params={"probe": "1"}, timeout=REQUEST_TIMEOUT_SECONDS)
    assert response.status_code == 404, f"expected 404, got {response.status_code}"
    assert response.json() == {"ok": False, "reason": "the health check takes no query string"}, response.text
    print("[test_health_refuses_a_query_string] refused with 404")


test_health_reports_the_recorders()
test_health_refuses_a_query_string()
