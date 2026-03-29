import { eq, inArray } from "drizzle-orm";
import { Session } from "@shopify/shopify-api";
import type { SessionStorage } from "@shopify/shopify-app-session-storage";
import { getDb } from "./db.server";
import { sessions, type SessionInsert, type SessionRow } from "./db/schema";

function sessionToRow(session: Session): SessionInsert {
  const payload = session.toObject();
  const associatedUser = payload.onlineAccessInfo?.associated_user;

  return {
    id: payload.id,
    shop: payload.shop,
    state: payload.state,
    isOnline: payload.isOnline,
    scope: payload.scope,
    expires: payload.expires,
    accessToken: payload.accessToken ?? "",
    userId: associatedUser?.id,
    firstName: associatedUser?.first_name,
    lastName: associatedUser?.last_name,
    email: associatedUser?.email,
    accountOwner: associatedUser?.account_owner ?? false,
    locale: associatedUser?.locale,
    collaborator: associatedUser?.collaborator ?? false,
    emailVerified: associatedUser?.email_verified ?? false,
    refreshToken: payload.refreshToken,
    refreshTokenExpires: payload.refreshTokenExpires,
  };
}

function rowToSession(row: SessionRow) {
  return new Session({
    id: row.id,
    shop: row.shop,
    state: row.state,
    isOnline: row.isOnline,
    scope: row.scope ?? undefined,
    expires: row.expires ?? undefined,
    accessToken: row.accessToken,
    refreshToken: row.refreshToken ?? undefined,
    refreshTokenExpires: row.refreshTokenExpires ?? undefined,
    onlineAccessInfo:
      row.isOnline && row.userId
        ? {
            expires_in: 0,
            associated_user_scope: row.scope ?? "",
            associated_user: {
              id: row.userId,
              first_name: row.firstName ?? "",
              last_name: row.lastName ?? "",
              email: row.email ?? "",
              email_verified: row.emailVerified ?? false,
              account_owner: row.accountOwner,
              locale: row.locale ?? "",
              collaborator: row.collaborator ?? false,
            },
          }
        : undefined,
  });
}

export const __sessionSerialization = {
  sessionToRow,
  rowToSession,
};

export class DrizzleSessionStorage implements SessionStorage {
  async storeSession(session: Session): Promise<boolean> {
    const row = sessionToRow(session);
    const db = await getDb();

    await db.insert(sessions).values(row).onConflictDoUpdate({
      target: sessions.id,
      set: row,
    });

    return true;
  }

  async loadSession(id: string): Promise<Session | undefined> {
    const db = await getDb();
    const row = await db.select().from(sessions).where(eq(sessions.id, id)).get();
    return row ? rowToSession(row) : undefined;
  }

  async deleteSession(id: string): Promise<boolean> {
    const db = await getDb();
    await db.delete(sessions).where(eq(sessions.id, id));
    return true;
  }

  async deleteSessions(ids: string[]): Promise<boolean> {
    if (ids.length === 0) {
      return true;
    }

    const db = await getDb();
    await db.delete(sessions).where(inArray(sessions.id, ids));
    return true;
  }

  async deleteSessionsByShop(shop: string): Promise<boolean> {
    const db = await getDb();
    await db.delete(sessions).where(eq(sessions.shop, shop));
    return true;
  }

  async updateScope(id: string, scope: string): Promise<boolean> {
    const db = await getDb();
    await db.update(sessions).set({ scope }).where(eq(sessions.id, id));
    return true;
  }

  async findSessionsByShop(shop: string): Promise<Session[]> {
    const db = await getDb();
    const rows = await db.select().from(sessions).where(eq(sessions.shop, shop));
    return rows.map(rowToSession);
  }
}

const sessionStorage = new DrizzleSessionStorage();

export default sessionStorage;
