# TestSprite backend test: the case file download (/cases/<slug>/case-file) carries the SHA-256 of its case's canonical
# form, in the body and in the X-Content-SHA256 header, and the test recomputes it the way the file says to.
# Route: src/app/cases/[slug]/case-file/route.ts; hash: toCanonicalJson and sha256Hex in src/lib/cases/case-export.ts.
# Runs top to bottom in TestSprite's Python sandbox (standard library plus requests); the calls at the end run it.
import hashlib
import json

import requests

BASE_URL = "https://cabletrace.vercel.app"
REQUEST_TIMEOUT_SECONDS = 30
# sourceRef: CASE_FILE_FORMAT in src/lib/cases/case-export.ts.
CASE_FILE_FORMAT = "cabletrace-case/1"
# Two cases with different evidence: placed positions only, and placed positions then recorded AIS.
CASE_SLUGS = ["eagle-s-2024", "yi-peng-3-2024"]


def compute_canonical_sha256(case_value: object) -> str:
    """SHA-256 hex of the case as JSON with every object's keys sorted and no whitespace (the file's hashMethod)."""
    canonical_text = json.dumps(case_value, sort_keys=True, separators=(",", ":"), ensure_ascii=False)
    return hashlib.sha256(canonical_text.encode("utf-8")).hexdigest()


def test_case_file_hash_matches_its_content(slug: str) -> None:
    response = requests.get(f"{BASE_URL}/cases/{slug}/case-file", timeout=REQUEST_TIMEOUT_SECONDS)
    assert response.status_code == 200, f"{slug}: expected 200, got {response.status_code}"
    disposition = response.headers.get("content-disposition", "")
    assert disposition == f'attachment; filename="cabletrace-{slug}.json"', disposition
    case_file = response.json()
    assert case_file["format"] == CASE_FILE_FORMAT, case_file["format"]
    assert case_file["slug"] == slug, case_file["slug"]
    assert "keys of every object sorted" in case_file["hashMethod"], case_file["hashMethod"]
    recorded_hash = case_file["contentSha256"]
    assert response.headers.get("x-content-sha256") == recorded_hash, "the header and the body disagree"
    computed_hash = compute_canonical_sha256(case_file["case"])
    assert computed_hash == recorded_hash, f"{slug}: recomputed {computed_hash}, file says {recorded_hash}"
    print(f"[test_case_file_hash_matches_its_content] {slug} intact, sha256 {recorded_hash[:12]}")


def test_unknown_case_file_is_404() -> None:
    response = requests.get(f"{BASE_URL}/cases/not-a-real-case/case-file", timeout=REQUEST_TIMEOUT_SECONDS)
    assert response.status_code == 404, f"expected 404, got {response.status_code}"
    print("[test_unknown_case_file_is_404] 404")


for case_slug in CASE_SLUGS:
    test_case_file_hash_matches_its_content(case_slug)
test_unknown_case_file_is_404()
