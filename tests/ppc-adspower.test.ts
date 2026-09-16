import test from "node:test";
import assert from "node:assert/strict";
import { getAdsPowerLocalApiUrl, startAdsPowerProfile, stopAdsPowerProfile } from "../lib/ppc/adspower-service";

test("getAdsPowerLocalApiUrl returns string URL with valid format", () => {
  const url = getAdsPowerLocalApiUrl();
  assert.ok(typeof url === "string");
  assert.ok(url.startsWith("http://") || url.startsWith("https://"));
  assert.ok(!url.endsWith("/"));
});

test("startAdsPowerProfile returns null safely when AdsPower is not running and profile is not found", async () => {
  // Test with non-existent profile and custom unreachable API URL
  const originalApiUrl = process.env.ADSPOWER_API_URL;
  try {
    process.env.ADSPOWER_API_URL = "http://127.0.0.1:59999"; // non-existent port
    const port = await startAdsPowerProfile({
      storeName: "NON_EXISTENT_STORE_XYZ",
    });
    assert.equal(port, null);
  } finally {
    if (originalApiUrl) {
      process.env.ADSPOWER_API_URL = originalApiUrl;
    } else {
      delete process.env.ADSPOWER_API_URL;
    }
  }
});

test("stopAdsPowerProfile does not crash when stopping non-running profile", async () => {
  const originalApiUrl = process.env.ADSPOWER_API_URL;
  try {
    process.env.ADSPOWER_API_URL = "http://127.0.0.1:59999";
    await assert.doesNotReject(async () => {
      await stopAdsPowerProfile("fake_profile_id");
    });
  } finally {
    if (originalApiUrl) {
      process.env.ADSPOWER_API_URL = originalApiUrl;
    } else {
      delete process.env.ADSPOWER_API_URL;
    }
  }
});
