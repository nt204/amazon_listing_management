import test from "node:test";
import assert from "node:assert/strict";
import {
  getCachedGroupedRecommendations,
  groupedRecommendationsCacheKey,
  groupedRecommendationsRedisKey,
  setCachedGroupedRecommendations,
} from "../lib/ppc/recommendation-cache";

test("grouped recommendation cache isolates 7D and 30D windows", () => {
  const testRun = `${Date.now()}-${Math.random()}`;
  const key7d = groupedRecommendationsCacheKey(testRun, "store-1", "HSOSTORE", 7);
  const key30d = groupedRecommendationsCacheKey(testRun, "store-1", "HSOSTORE", 30);
  const result7d = {
    groups: [],
    allRecommendations: [],
    totalRecommendations: 7,
    totalSkus: 1,
  };
  const result30d = {
    groups: [],
    allRecommendations: [],
    totalRecommendations: 30,
    totalSkus: 1,
  };

  assert.notEqual(key7d, key30d);
  assert.notEqual(
    groupedRecommendationsRedisKey("team-1", "HSOSTORE", 7),
    groupedRecommendationsRedisKey("team-1", "HSOSTORE", 30),
  );
  setCachedGroupedRecommendations(key7d, result7d);
  setCachedGroupedRecommendations(key30d, result30d);
  assert.equal(getCachedGroupedRecommendations(key7d)?.totalRecommendations, 7);
  assert.equal(getCachedGroupedRecommendations(key30d)?.totalRecommendations, 30);

});
