import test from "node:test";
import assert from "node:assert/strict";
import {
  createLegalEntity,
  createStore,
  deleteStore,
  getStoreById,
  listLegalEntities,
  listStores,
  updateStore,
} from "@/lib/accounting/accounting-db";

test("accounting store management: seed data and basic CRUD operations", async () => {
  // 1. Verify legal entities exist
  const entities = await listLegalEntities();
  assert.ok(entities.length > 0, "Expected at least one legal entity");

  // 2. Verify seeded stores
  const stores = await listStores();
  assert.ok(stores.length >= 5, "Expected at least 5 seeded stores");
  const storeNames = stores.map((s) => s.name.toLowerCase());
  assert.ok(storeNames.includes("warmstorey"), "Expected warmstorey in stores");
  assert.ok(storeNames.includes("fastpeace"), "Expected fastpeace in stores");
  assert.ok(storeNames.includes("limima"), "Expected limima in stores");

  // 3. Create a new legal entity
  const testEntity = await createLegalEntity({
    name: "Test Entity Ltd",
    country: "United Kingdom",
    status: "active",
  });
  assert.ok(testEntity.id, "Expected created entity to have an ID");
  assert.equal(testEntity.name, "Test Entity Ltd");
  assert.equal(testEntity.country, "United Kingdom");

  // 4. Create a new store
  const newStore = await createStore({
    name: "test-unit-store",
    marketplace: "Amazon UK",
    team: "Alpha Team",
    legal_entity_id: testEntity.id,
    seller_id: "A1234567890",
    status: "active",
  });
  assert.ok(newStore.id, "Expected created store to have an ID");
  assert.equal(newStore.name, "test-unit-store");
  assert.equal(newStore.marketplace, "Amazon UK");
  assert.equal(newStore.team, "Alpha Team");
  assert.equal(newStore.legal_entity_id, testEntity.id);
  assert.equal(newStore.seller_id, "A1234567890");

  // 5. Fetch by ID
  const fetched = await getStoreById(newStore.id);
  assert.ok(fetched, "Expected to find store by ID");
  assert.equal(fetched.name, "test-unit-store");
  assert.equal(fetched.team, "Alpha Team");
  assert.equal(fetched.legal_entity_name, "Test Entity Ltd");

  // 6. Update the store
  const updated = await updateStore(newStore.id, {
    name: "test-unit-store-updated",
    status: "inactive",
  });
  assert.ok(updated, "Expected update to succeed");
  assert.equal(updated.name, "test-unit-store-updated");
  assert.equal(updated.status, "inactive");

  // 7. Delete the store
  const deleted = await deleteStore(newStore.id);
  assert.equal(deleted, true, "Expected delete to return true");

  const checkDeleted = await getStoreById(newStore.id);
  assert.equal(checkDeleted, null, "Expected store to no longer exist");

  const { closeDatabaseConnection } = await import("@/lib/db");
  await closeDatabaseConnection();
});
