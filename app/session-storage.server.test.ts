import assert from "node:assert/strict";
import test from "node:test";
import { Session } from "@shopify/shopify-api";
import { __sessionSerialization } from "./session-storage.server";

test("session serialization preserves offline session fields", () => {
  const expires = new Date("2026-03-20T10:00:00.000Z");
  const refreshTokenExpires = new Date("2026-03-21T10:00:00.000Z");

  const session = new Session({
    id: "offline_test-shop.myshopify.com",
    shop: "test-shop.myshopify.com",
    state: "offline-state",
    isOnline: false,
    scope: "write_products",
    accessToken: "offline-token",
    expires,
    refreshToken: "refresh-token",
    refreshTokenExpires,
  });

  const row = __sessionSerialization.sessionToRow(session);
  const roundTrip = __sessionSerialization.rowToSession({
    ...row,
    accessToken: row.accessToken ?? "",
    accountOwner: row.accountOwner ?? false,
    collaborator: row.collaborator ?? false,
    email: row.email ?? null,
    emailVerified: row.emailVerified ?? false,
    expires: row.expires ?? null,
    firstName: row.firstName ?? null,
    isOnline: row.isOnline ?? false,
    lastName: row.lastName ?? null,
    locale: row.locale ?? null,
    refreshToken: row.refreshToken ?? null,
    refreshTokenExpires: row.refreshTokenExpires ?? null,
    scope: row.scope ?? null,
    userId: row.userId ?? null,
  });

  assert.equal(row.shop, "test-shop.myshopify.com");
  assert.equal(roundTrip.id, session.id);
  assert.equal(roundTrip.accessToken, "offline-token");
  assert.equal(roundTrip.refreshToken, "refresh-token");
  assert.deepEqual(roundTrip.expires, expires);
  assert.deepEqual(roundTrip.refreshTokenExpires, refreshTokenExpires);
});

test("session serialization preserves online access info", () => {
  const session = new Session({
    id: "online_test-shop.myshopify.com_123",
    shop: "test-shop.myshopify.com",
    state: "online-state",
    isOnline: true,
    scope: "write_products",
    accessToken: "online-token",
    onlineAccessInfo: {
      expires_in: 3600,
      associated_user_scope: "write_products",
      associated_user: {
        id: 123,
        first_name: "Ada",
        last_name: "Lovelace",
        email: "ada@example.com",
        email_verified: true,
        account_owner: true,
        locale: "en",
        collaborator: false,
      },
    },
  });

  const row = __sessionSerialization.sessionToRow(session);
  const roundTrip = __sessionSerialization.rowToSession({
    ...row,
    accessToken: row.accessToken ?? "",
    accountOwner: row.accountOwner ?? false,
    collaborator: row.collaborator ?? false,
    email: row.email ?? null,
    emailVerified: row.emailVerified ?? false,
    expires: row.expires ?? null,
    firstName: row.firstName ?? null,
    isOnline: row.isOnline ?? true,
    lastName: row.lastName ?? null,
    locale: row.locale ?? null,
    refreshToken: row.refreshToken ?? null,
    refreshTokenExpires: row.refreshTokenExpires ?? null,
    scope: row.scope ?? null,
    userId: row.userId ?? 123,
  });

  assert.equal(row.userId, 123);
  assert.equal(row.firstName, "Ada");
  assert.equal(row.emailVerified, true);
  assert.equal(roundTrip.onlineAccessInfo?.associated_user.id, 123);
  assert.equal(roundTrip.onlineAccessInfo?.associated_user.email, "ada@example.com");
  assert.equal(roundTrip.onlineAccessInfo?.associated_user.account_owner, true);
});
