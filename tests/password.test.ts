import assert from "node:assert/strict";
import test from "node:test";
import { hashPassword, verifyPassword } from "../lib/password-core";

test("passwords are salted and verified with scrypt", () => {
  const password = "A-long-private-password-4829";
  const first = hashPassword(password);
  const second = hashPassword(password);

  assert.notEqual(first, second);
  assert.equal(first.startsWith("scrypt-v1$"), true);
  assert.equal(first.includes(password), false);
  assert.equal(verifyPassword(password, first), true);
  assert.equal(verifyPassword("wrong-password", first), false);
  assert.equal(verifyPassword(password, "invalid"), false);
});
