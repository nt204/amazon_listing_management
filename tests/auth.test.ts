import assert from "node:assert/strict";
import test from "node:test";
import {
  AuthError,
  authenticateRequest,
  authenticateTeamToken,
  createSessionToken,
  verifySessionToken,
} from "../lib/auth";

test("team tokens create signed sessions and enforce role permissions", () => {
  const previous = {
    mode: process.env.LISTING_DESK_AUTH_MODE,
    teams: process.env.LISTING_DESK_TEAMS_JSON,
    secret: process.env.LISTING_DESK_SESSION_SECRET,
  };
  process.env.LISTING_DESK_AUTH_MODE = "required";
  process.env.LISTING_DESK_SESSION_SECRET = "test-session-secret-that-is-longer-than-thirty-two-characters";
  process.env.LISTING_DESK_TEAMS_JSON = JSON.stringify([{
    team_id: "team-a",
    user_id: "editor-a",
    display_name: "Editor A",
    token: "team-a-token-that-is-at-least-24-characters",
    role: "editor",
    rule_profile: "amazon-pod",
  }]);
  try {
    const actor = authenticateTeamToken("team-a-token-that-is-at-least-24-characters");
    assert.ok(actor);
    assert.equal(actor.teamId, "team-a");
    assert.equal(actor.ruleProfile, "amazon-pod");
    const session = createSessionToken(actor);
    assert.deepEqual(verifySessionToken(session), actor);

    const bearerRequest = new Request("https://listing.example/api/listings", {
      headers: { authorization: "Bearer team-a-token-that-is-at-least-24-characters" },
    });
    assert.equal(authenticateRequest(bearerRequest, "write").userId, "editor-a");
    assert.throws(
      () => authenticateRequest(bearerRequest, "approve"),
      (error) => error instanceof AuthError && error.status === 403,
    );
  } finally {
    if (previous.mode === undefined) delete process.env.LISTING_DESK_AUTH_MODE;
    else process.env.LISTING_DESK_AUTH_MODE = previous.mode;
    if (previous.teams === undefined) delete process.env.LISTING_DESK_TEAMS_JSON;
    else process.env.LISTING_DESK_TEAMS_JSON = previous.teams;
    if (previous.secret === undefined) delete process.env.LISTING_DESK_SESSION_SECRET;
    else process.env.LISTING_DESK_SESSION_SECRET = previous.secret;
  }
});
