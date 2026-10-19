# TestSprite backend test: /api/ship-frames serves the live globe's frame index and frames, and answers only the
# canonical URLs the CDN can cache. Route: src/app/api/ship-frames/[...objectPath]/route.ts.
# Runs top to bottom in TestSprite's Python sandbox (standard library plus requests); the calls at the end run it.
import requests

BASE_URL = "https://cabletrace.vercel.app"
REQUEST_TIMEOUT_SECONDS = 30
# sourceRef: SLOT_MS (10 minutes) and FRAME_RETENTION_MS (47 hours) in src/lib/live/frame-layout.ts.
SLOT_MINUTES = 10
RETENTION_HOURS = 47


def test_frame_index_lists_recent_frames() -> None:
    response = requests.get(f"{BASE_URL}/api/ship-frames/index.json", timeout=REQUEST_TIMEOUT_SECONDS)
    assert response.status_code == 200, f"expected 200, got {response.status_code}"
    index = response.json()
    assert index["slotMinutes"] == SLOT_MINUTES, index["slotMinutes"]
    frames = index["frames"]
    assert len(frames) >= 1, "the collector has stored no frame"
    newest_frame = max(frames, key=lambda frame: frame["slotStartMs"])
    hours_since_newest = (index["generatedAtMs"] - newest_frame["slotStartMs"]) / 3_600_000
    assert hours_since_newest < 1, f"the newest frame is {hours_since_newest:.1f} hours old"
    oldest_frame = min(frames, key=lambda frame: frame["slotStartMs"])
    assert (index["generatedAtMs"] - oldest_frame["slotStartMs"]) / 3_600_000 <= RETENTION_HOURS + 1, "a frame outlived its retention"
    assert all(frame["path"].startswith("frames/") and frame["path"].endswith(".bin.gz") for frame in frames), "unexpected frame path"
    frame_response = requests.get(f"{BASE_URL}/api/ship-frames/{newest_frame['path']}", timeout=REQUEST_TIMEOUT_SECONDS)
    assert frame_response.status_code == 200, f"newest frame answered {frame_response.status_code}"
    assert len(frame_response.content) > 0, "the newest frame is empty"
    print(f"[test_frame_index_lists_recent_frames] {len(frames)} frames, newest {hours_since_newest * 60:.0f} minutes old")


def test_frames_route_refuses_other_urls() -> None:
    query_response = requests.get(f"{BASE_URL}/api/ship-frames/index.json", params={"fresh": "1"}, timeout=REQUEST_TIMEOUT_SECONDS)
    assert query_response.status_code == 404, f"query string answered {query_response.status_code}"
    assert query_response.json()["reason"] == "ship frame URLs take no query string", query_response.text
    other_response = requests.get(f"{BASE_URL}/api/ship-frames/secrets.json", timeout=REQUEST_TIMEOUT_SECONDS)
    assert other_response.status_code == 404, f"another object answered {other_response.status_code}"
    assert other_response.json()["reason"] == "not a ship frame or the frame index", other_response.text
    print("[test_frames_route_refuses_other_urls] both refused with 404")


test_frame_index_lists_recent_frames()
test_frames_route_refuses_other_urls()
