import { and, eq, isNull } from "drizzle-orm";
import { allSql, getDb, runSql, type AppDb } from "./db.server";
import {
  decryptMcpSecret,
  encryptMcpSecret,
  createMcpSecret,
  hashMcpSecret,
} from "./mcp-secret.server";
import {
  mcpConnections,
  mcpSecrets,
  sessions,
  type McpConnectionRow,
  type McpSecretRow,
  type SessionRow,
} from "./db/schema";

function createMcpKey() {
  return crypto.randomUUID().replaceAll("-", "") + crypto.randomUUID().replaceAll("-", "");
}

function createSecretId() {
  return crypto.randomUUID().replaceAll("-", "");
}

async function findShopSessions(shop: string, db: AppDb) {
  return db.select().from(sessions).where(eq(sessions.shop, shop));
}

type RawMcpConnectionRow = {
  key: string;
  shop: string;
  sessionId: string;
  secretHash: string | null;
  createdAt: number;
  updatedAt: number;
};

type RawMcpSecretRow = {
  id: string;
  connectionKey: string;
  shop: string;
  label: string;
  secretCiphertext: string | null;
  secretHash: string;
  createdAt: number;
  updatedAt: number;
  revokedAt: number | null;
};

type RawSessionRow = {
  id: string;
  shop: string;
  state: string;
  isOnline: number | boolean;
  scope: string | null;
  expires: number | null;
  accessToken: string;
  userId: number | null;
  firstName: string | null;
  lastName: string | null;
  email: string | null;
  accountOwner: number | boolean;
  locale: string | null;
  collaborator: number | boolean | null;
  emailVerified: number | boolean | null;
  refreshToken: string | null;
  refreshTokenExpires: number | null;
};

export type McpSecretSummary = {
  id: string;
  label: string;
  createdAt: Date;
  updatedAt: Date;
  revokedAt: Date | null;
  canReveal: boolean;
};

function mapMcpConnectionRow(row: RawMcpConnectionRow): McpConnectionRow {
  return {
    connectionKey: row.key,
    shop: row.shop,
    sessionId: row.sessionId,
    secretHash: row.secretHash,
    createdAt: new Date(row.createdAt),
    updatedAt: new Date(row.updatedAt),
  };
}

function mapMcpSecretRow(row: RawMcpSecretRow): McpSecretRow {
  return {
    id: row.id,
    connectionKey: row.connectionKey,
    shop: row.shop,
    label: row.label,
    secretCiphertext: row.secretCiphertext,
    secretHash: row.secretHash,
    createdAt: new Date(row.createdAt),
    updatedAt: new Date(row.updatedAt),
    revokedAt: row.revokedAt === null ? null : new Date(row.revokedAt),
  };
}

function mapSessionRow(row: RawSessionRow): SessionRow {
  return {
    id: row.id,
    shop: row.shop,
    state: row.state,
    isOnline: Boolean(row.isOnline),
    scope: row.scope,
    expires: row.expires === null ? null : new Date(row.expires),
    accessToken: row.accessToken,
    userId: row.userId,
    firstName: row.firstName,
    lastName: row.lastName,
    email: row.email,
    accountOwner: Boolean(row.accountOwner),
    locale: row.locale,
    collaborator: row.collaborator === null ? null : Boolean(row.collaborator),
    emailVerified: row.emailVerified === null ? null : Boolean(row.emailVerified),
    refreshToken: row.refreshToken,
    refreshTokenExpires:
      row.refreshTokenExpires === null ? null : new Date(row.refreshTokenExpires),
  };
}

function summarizeMcpSecret(row: McpSecretRow): McpSecretSummary {
  return {
    id: row.id,
    label: row.label,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    revokedAt: row.revokedAt,
    canReveal: row.secretCiphertext !== null,
  };
}

function trimSecretLabel(label: string) {
  const trimmed = label.trim();
  if (!trimmed) {
    throw new Error("Secret label is required.");
  }

  return trimmed.slice(0, 80);
}

function sortSecrets(rows: McpSecretRow[]) {
  return [...rows].sort((left, right) => {
    const leftRevoked = left.revokedAt ? 1 : 0;
    const rightRevoked = right.revokedAt ? 1 : 0;
    if (leftRevoked !== rightRevoked) {
      return leftRevoked - rightRevoked;
    }

    return right.createdAt.getTime() - left.createdAt.getTime();
  });
}

async function findShopSessionsSql(shop: string) {
  const rows = await allSql<RawSessionRow>(
    `select
      id,
      shop,
      state,
      isOnline,
      scope,
      expires,
      accessToken,
      userId,
      firstName,
      lastName,
      email,
      accountOwner,
      locale,
      collaborator,
      emailVerified,
      refreshToken,
      refreshTokenExpires
    from Session
    where shop = ?
    order by isOnline asc, id asc`,
    [shop],
  );

  return rows.map(mapSessionRow);
}

async function getMcpConnectionsForShopSql(shop: string) {
  const rows = await allSql<RawMcpConnectionRow>(
    `select key, shop, sessionId, secretHash, createdAt, updatedAt
    from McpConnection
    where shop = ?
    order by updatedAt desc, createdAt desc, key desc`,
    [shop],
  );

  return rows.map(mapMcpConnectionRow);
}

async function getMcpConnectionByKeySql(key: string) {
  const rows = await allSql<RawMcpConnectionRow>(
    `select key, shop, sessionId, secretHash, createdAt, updatedAt
    from McpConnection
    where key = ?
    limit 1`,
    [key],
  );

  return rows[0] ? mapMcpConnectionRow(rows[0]) : undefined;
}

async function getMcpSecretByHashSql(secretHash: string) {
  const rows = await allSql<RawMcpSecretRow>(
    `select id, connectionKey, shop, label, secretCiphertext, secretHash, createdAt, updatedAt, revokedAt
    from McpSecret
    where secretHash = ? and revokedAt is null
    limit 1`,
    [secretHash],
  );

  return rows[0] ? mapMcpSecretRow(rows[0]) : undefined;
}

async function getSessionByIdSql(id: string) {
  const rows = await allSql<RawSessionRow>(
    `select
      id,
      shop,
      state,
      isOnline,
      scope,
      expires,
      accessToken,
      userId,
      firstName,
      lastName,
      email,
      accountOwner,
      locale,
      collaborator,
      emailVerified,
      refreshToken,
      refreshTokenExpires
    from Session
    where id = ?
    limit 1`,
    [id],
  );

  return rows[0] ? mapSessionRow(rows[0]) : undefined;
}

async function listMcpSecretsForShopSql(shop: string) {
  const rows = await allSql<RawMcpSecretRow>(
    `select id, connectionKey, shop, label, secretCiphertext, secretHash, createdAt, updatedAt, revokedAt
    from McpSecret
    where shop = ?
    order by case when revokedAt is null then 0 else 1 end asc, createdAt desc, id desc`,
    [shop],
  );

  return rows.map(mapMcpSecretRow);
}

async function getMcpSecretByIdSql(id: string, shop: string) {
  const rows = await allSql<RawMcpSecretRow>(
    `select id, connectionKey, shop, label, secretCiphertext, secretHash, createdAt, updatedAt, revokedAt
    from McpSecret
    where id = ? and shop = ?
    limit 1`,
    [id, shop],
  );

  return rows[0] ? mapMcpSecretRow(rows[0]) : undefined;
}

async function hasActiveSecretHashSql(shop: string, secretHash: string) {
  const rows = await allSql<{ id: string }>(
    `select id
    from McpSecret
    where shop = ? and secretHash = ? and revokedAt is null
    limit 1`,
    [shop, secretHash],
  );

  return Boolean(rows[0]);
}

async function hasActiveSecretForKeySql(connectionKey: string, secretHash: string) {
  const rows = await allSql<{ id: string }>(
    `select id
    from McpSecret
    where connectionKey = ? and secretHash = ? and revokedAt is null
    limit 1`,
    [connectionKey, secretHash],
  );

  return Boolean(rows[0]);
}

async function updateSecretConnectionKeys(oldKey: string, newKey: string, updatedAt: Date, db?: AppDb) {
  if (db) {
    await db
      .update(mcpSecrets)
      .set({
        connectionKey: newKey,
        updatedAt,
      })
      .where(eq(mcpSecrets.connectionKey, oldKey));
    return;
  }

  await runSql(`update McpSecret set connectionKey = ?, updatedAt = ? where connectionKey = ?`, [
    newKey,
    updatedAt.getTime(),
    oldKey,
  ]);
}

async function pruneDuplicateConnections(shop: string, keepKey: string) {
  await runSql(`delete from McpConnection where shop = ? and key <> ?`, [shop, keepKey]);
}

function pickSession(rows: SessionRow[], currentSessionId?: string) {
  const offlineSession = rows.find((row) => !row.isOnline);
  if (offlineSession) {
    return offlineSession;
  }

  if (currentSessionId) {
    return rows.find((row) => row.id === currentSessionId);
  }

  return rows[0];
}

async function resolveTargetSession(shop: string, currentSessionId?: string, db?: AppDb) {
  const resolvedDb = db ?? (await getDb());
  const rows = db ? await findShopSessions(shop, resolvedDb) : await findShopSessionsSql(shop);
  const session = pickSession(rows, currentSessionId);

  if (!session) {
    throw new Error(`No persisted Shopify session found for shop ${shop}`);
  }

  return { db: resolvedDb, session };
}

export async function getMcpConnectionForShop(shop: string, db?: AppDb) {
  if (!db) {
    const [connection] = await getMcpConnectionsForShopSql(shop);
    return connection;
  }

  return db.select().from(mcpConnections).where(eq(mcpConnections.shop, shop)).get();
}

export async function getMcpConnectionByKey(key: string, db?: AppDb) {
  if (!db) {
    return getMcpConnectionByKeySql(key);
  }

  return db.select().from(mcpConnections).where(eq(mcpConnections.connectionKey, key)).get();
}

export async function getMcpConnectionBySecret(secret: string, db?: AppDb) {
  const secretHash = await hashMcpSecret(secret);

  if (!db) {
    const secretRow = await getMcpSecretByHashSql(secretHash);
    return secretRow ? getMcpConnectionByKey(secretRow.connectionKey) : undefined;
  }

  const secretRow = await db
    .select()
    .from(mcpSecrets)
    .where(and(eq(mcpSecrets.secretHash, secretHash), isNull(mcpSecrets.revokedAt)))
    .get();

  return secretRow ? getMcpConnectionByKey(secretRow.connectionKey, db) : undefined;
}

export async function ensureMcpConnectionForShop(shop: string, currentSessionId?: string, db?: AppDb) {
  const existing = await getMcpConnectionForShop(shop, db);
  if (existing) {
    return synchronizeMcpConnectionForShop(shop, currentSessionId, db).then(
      (connection) => connection ?? existing,
    );
  }

  return regenerateMcpConnectionForShop(shop, currentSessionId, db);
}

export async function synchronizeMcpConnectionForShop(
  shop: string,
  currentSessionId?: string,
  db?: AppDb,
) {
  const existing = await getMcpConnectionForShop(shop, db);
  if (!existing) {
    return undefined;
  }

  const { db: resolvedDb, session } = await resolveTargetSession(shop, currentSessionId, db);
  if (existing.sessionId === session.id) {
    return existing;
  }

  const updatedAt = new Date();
  if (db) {
    await resolvedDb
      .update(mcpConnections)
      .set({
        sessionId: session.id,
        updatedAt,
      })
      .where(eq(mcpConnections.shop, shop));
  } else {
    await runSql(`update McpConnection set sessionId = ?, updatedAt = ? where key = ?`, [
      session.id,
      updatedAt.getTime(),
      existing.connectionKey,
    ]);
    await pruneDuplicateConnections(shop, existing.connectionKey);
  }

  return {
    ...existing,
    sessionId: session.id,
    updatedAt,
  } satisfies McpConnectionRow;
}

export async function regenerateMcpConnectionForShop(
  shop: string,
  currentSessionId?: string,
  db?: AppDb,
) {
  const { db: resolvedDb, session } = await resolveTargetSession(shop, currentSessionId, db);
  const existing = await getMcpConnectionForShop(shop, db);
  const now = new Date();
  const nextKey = createMcpKey();
  const row = {
    connectionKey: nextKey,
    shop,
    sessionId: session.id,
    secretHash: existing?.secretHash ?? null,
    createdAt: now,
    updatedAt: now,
  };

  if (db) {
    if (existing) {
      await resolvedDb
        .update(mcpConnections)
        .set({
          connectionKey: row.connectionKey,
          sessionId: row.sessionId,
          updatedAt: row.updatedAt,
        })
        .where(eq(mcpConnections.shop, shop));
      await updateSecretConnectionKeys(existing.connectionKey, row.connectionKey, row.updatedAt, db);
    } else {
      await resolvedDb.insert(mcpConnections).values(row);
    }
  } else if (existing) {
    await runSql(
      `update McpConnection
      set key = ?, sessionId = ?, updatedAt = ?
      where key = ?`,
      [row.connectionKey, row.sessionId, row.updatedAt.getTime(), existing.connectionKey],
    );
    await updateSecretConnectionKeys(existing.connectionKey, row.connectionKey, row.updatedAt);
    await pruneDuplicateConnections(shop, row.connectionKey);
  } else {
    await runSql(
      `insert into McpConnection (key, shop, sessionId, secretHash, createdAt, updatedAt)
      values (?, ?, ?, ?, ?, ?)`,
      [
        row.connectionKey,
        row.shop,
        row.sessionId,
        row.secretHash,
        row.createdAt.getTime(),
        row.updatedAt.getTime(),
      ],
    );
  }

  return {
    ...row,
    createdAt: existing?.createdAt ?? now,
  } satisfies McpConnectionRow;
}

export async function resolveMcpSessionByKey(key: string, db?: AppDb) {
  const resolvedDb = db ?? (await getDb());
  const connection = await getMcpConnectionByKey(key, db);

  if (!connection) {
    return { connection: undefined, session: undefined };
  }

  const session = db
    ? await resolvedDb.select().from(sessions).where(eq(sessions.id, connection.sessionId)).get()
    : await getSessionByIdSql(connection.sessionId);

  return { connection, session };
}

export async function listMcpSecretSummariesForShop(shop: string, db?: AppDb) {
  const rows = !db
    ? await listMcpSecretsForShopSql(shop)
    : await db.select().from(mcpSecrets).where(eq(mcpSecrets.shop, shop)).all();
  return sortSecrets(rows).map(summarizeMcpSecret);
}

export async function createMcpSecretForShop(
  shop: string,
  label: string,
  currentSessionId?: string,
  db?: AppDb,
) {
  const connection = await ensureMcpConnectionForShop(shop, currentSessionId, db);
  const normalizedLabel = trimSecretLabel(label);
  const secret = createMcpSecret();
  const secretId = createSecretId();
  const secretHash = await hashMcpSecret(secret);
  const secretCiphertext = await encryptMcpSecret(secret);
  const now = new Date();

  if (db) {
    const duplicate = await db
      .select()
      .from(mcpSecrets)
      .where(
        and(
          eq(mcpSecrets.shop, shop),
          eq(mcpSecrets.secretHash, secretHash),
          isNull(mcpSecrets.revokedAt),
        ),
      )
      .get();
    if (duplicate) {
      throw new Error("Secret generation collision. Try again.");
    }

    await db.insert(mcpSecrets).values({
      id: secretId,
      connectionKey: connection.connectionKey,
      shop,
      label: normalizedLabel,
      secretCiphertext,
      secretHash,
      createdAt: now,
      updatedAt: now,
      revokedAt: null,
    });
  } else {
    if (await hasActiveSecretHashSql(shop, secretHash)) {
      throw new Error("Secret generation collision. Try again.");
    }

    await runSql(
      `insert into McpSecret (id, connectionKey, shop, label, secretCiphertext, secretHash, createdAt, updatedAt, revokedAt)
      values (?, ?, ?, ?, ?, ?, ?, ?, null)`,
      [
        secretId,
        connection.connectionKey,
        shop,
        normalizedLabel,
        secretCiphertext,
        secretHash,
        now.getTime(),
        now.getTime(),
      ],
    );
  }

  const secrets = await listMcpSecretSummariesForShop(shop, db);
  const createdSecret = secrets.find((row) => row.id === secretId);

  return {
    connection,
    secret,
    secretSummary: createdSecret ?? secrets[0],
    secrets,
  };
}

export async function revealMcpSecretForShop(secretId: string, shop: string, db?: AppDb) {
  const row = !db
    ? await getMcpSecretByIdSql(secretId, shop)
    : await db
        .select()
        .from(mcpSecrets)
        .where(and(eq(mcpSecrets.id, secretId), eq(mcpSecrets.shop, shop)))
        .get();

  if (!row) {
    throw new Error("Secret not found.");
  }

  if (row.revokedAt) {
    throw new Error("Revoked secrets cannot be revealed.");
  }

  if (!row.secretCiphertext) {
    throw new Error("Imported secrets cannot be revealed. Create a new secret instead.");
  }

  return {
    secret: await decryptMcpSecret(row.secretCiphertext),
    secretSummary: summarizeMcpSecret(row),
  };
}

export async function revokeMcpSecretForShop(secretId: string, shop: string, db?: AppDb) {
  const row = !db
    ? await getMcpSecretByIdSql(secretId, shop)
    : await db
        .select()
        .from(mcpSecrets)
        .where(and(eq(mcpSecrets.id, secretId), eq(mcpSecrets.shop, shop)))
        .get();

  if (!row) {
    throw new Error("Secret not found.");
  }

  if (!row.revokedAt) {
    const revokedAt = new Date();
    if (db) {
      await db
        .update(mcpSecrets)
        .set({
          revokedAt,
          updatedAt: revokedAt,
        })
        .where(eq(mcpSecrets.id, secretId));
    } else {
      await runSql(`update McpSecret set revokedAt = ?, updatedAt = ? where id = ?`, [
        revokedAt.getTime(),
        revokedAt.getTime(),
        secretId,
      ]);
    }
  }

  return listMcpSecretSummariesForShop(shop, db);
}

export async function purgeShopData(shop: string, db?: AppDb) {
  if (db) {
    await db.delete(mcpSecrets).where(eq(mcpSecrets.shop, shop));
    await db.delete(mcpConnections).where(eq(mcpConnections.shop, shop));
    await db.delete(sessions).where(eq(sessions.shop, shop));
    return;
  }

  await runSql(`delete from McpSecret where shop = ?`, [shop]);
  await runSql(`delete from McpConnection where shop = ?`, [shop]);
  await runSql(`delete from Session where shop = ?`, [shop]);
}

export async function verifyMcpSecretForKey(key: string, secret: string, db?: AppDb) {
  const secretHash = await hashMcpSecret(secret);
  if (!db) {
    return hasActiveSecretForKeySql(key, secretHash);
  }

  const row = await db
    .select()
    .from(mcpSecrets)
    .where(
      and(eq(mcpSecrets.connectionKey, key), eq(mcpSecrets.secretHash, secretHash), isNull(mcpSecrets.revokedAt)),
    )
    .get();
  return Boolean(row);
}

export async function getSessionById(id: string) {
  return getSessionByIdSql(id);
}

type SessionAuthUpdate = {
  accessToken: string;
  refreshToken: string | null;
  refreshTokenExpires: Date | null;
  expires: Date | null;
  scope: string | null;
};

export async function updateSessionAuth(sessionId: string, update: SessionAuthUpdate) {
  await runSql(
    `update Session
    set accessToken = ?, refreshToken = ?, refreshTokenExpires = ?, expires = ?, scope = ?
    where id = ?`,
    [
      update.accessToken,
      update.refreshToken,
      update.refreshTokenExpires?.getTime() ?? null,
      update.expires?.getTime() ?? null,
      update.scope,
      sessionId,
    ],
  );

  return getSessionByIdSql(sessionId);
}
