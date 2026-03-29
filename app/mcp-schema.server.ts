import { allSql, runSql } from "./db.server";

const MCP_CONNECTION_CREATE_SQL = `create table if not exists McpConnection (
  key text primary key not null,
  shop text not null unique,
  sessionId text not null,
  secretHash text,
  createdAt integer not null,
  updatedAt integer not null
)`;

const MCP_SECRET_CREATE_SQL = `create table if not exists McpSecret (
  id text primary key not null,
  connectionKey text not null,
  shop text not null,
  label text not null,
  secretCiphertext text,
  secretHash text not null,
  createdAt integer not null,
  updatedAt integer not null,
  revokedAt integer
)`;

const MCP_CONNECTION_REBUILD_STATEMENTS = [
  `create table __new_McpConnection (
    key text primary key not null,
    shop text not null unique,
    sessionId text not null,
    secretHash text,
    createdAt integer not null,
    updatedAt integer not null
  )`,
  `drop table McpConnection`,
  `alter table __new_McpConnection rename to McpConnection`,
] as const;

type SqliteMasterRow = {
  sql: string | null;
};

type TableInfoRow = {
  name: string;
};

type McpConnectionSecretImportRow = {
  key: string;
  shop: string;
  secretHash: string | null;
  createdAt: number;
  updatedAt: number;
};

let schemaRepairPromise: Promise<void> | undefined;

async function getMcpConnectionTableSql() {
  const rows = await allSql<SqliteMasterRow>(
    `select sql from sqlite_master where type = 'table' and name = 'McpConnection' limit 1`,
  );
  return rows[0]?.sql ?? null;
}

async function hasMcpSecretHashColumn() {
  const rows = await allSql<TableInfoRow>(`select name from pragma_table_info('McpConnection')`);
  return rows.some((row) => row.name === "secretHash");
}

async function hasMcpSecretTable() {
  const rows = await allSql<{ name: string }>(
    `select name from sqlite_master where type = 'table' and name = 'McpSecret' limit 1`,
  );
  return rows.length > 0;
}

async function importLegacySecrets() {
  const rows = await allSql<McpConnectionSecretImportRow>(
    `select key, shop, secretHash, createdAt, updatedAt
    from McpConnection
    where secretHash is not null`,
  );

  for (const row of rows) {
    const existing = await allSql<{ count: number }>(
      `select count(*) as count
      from McpSecret
      where connectionKey = ?
        and secretHash = ?
        and revokedAt is null`,
      [row.key, row.secretHash],
    );

    if ((existing[0]?.count ?? 0) > 0) {
      continue;
    }

    await runSql(
      `insert into McpSecret (id, connectionKey, shop, label, secretCiphertext, secretHash, createdAt, updatedAt, revokedAt)
      values (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        crypto.randomUUID(),
        row.key,
        row.shop,
        "Imported secret",
        null,
        row.secretHash,
        row.createdAt,
        row.updatedAt,
        null,
      ],
    );
  }
}

function hasUniqueShopConstraint(createTableSql: string | null) {
  const normalized = createTableSql?.toLowerCase() ?? "";
  return normalized.includes("shop text not null unique") && normalized.includes("secrethash text");
}

async function repairMcpConnectionSchema() {
  const currentSql = await getMcpConnectionTableSql();

  if (!currentSql) {
    await runSql(MCP_CONNECTION_CREATE_SQL);
    await runSql(MCP_SECRET_CREATE_SQL);
    console.info(JSON.stringify({ event: "mcp_schema_created" }));
    return;
  }

  if (hasUniqueShopConstraint(currentSql)) {
    if (!(await hasMcpSecretTable())) {
      await runSql(MCP_SECRET_CREATE_SQL);
    }
    await importLegacySecrets();
    return;
  }

  const hasSecretHashColumn = await hasMcpSecretHashColumn();
  const copyRowsStatement = `insert into __new_McpConnection (key, shop, sessionId, secretHash, createdAt, updatedAt)
    select key, shop, sessionId, ${hasSecretHashColumn ? "secretHash" : "null"} as secretHash, createdAt, updatedAt
    from (
      select
        key,
        shop,
        sessionId,
        ${hasSecretHashColumn ? "secretHash," : ""}
        createdAt,
        updatedAt,
        row_number() over (
          partition by shop
          order by updatedAt desc, createdAt desc, key desc
        ) as rowNumber
      from McpConnection
    )
    where rowNumber = 1`;

  for (const statement of [MCP_CONNECTION_REBUILD_STATEMENTS[0], copyRowsStatement, ...MCP_CONNECTION_REBUILD_STATEMENTS.slice(1)]) {
    await runSql(statement);
  }

  await runSql(MCP_SECRET_CREATE_SQL);
  await importLegacySecrets();

  console.info(JSON.stringify({ event: "mcp_schema_rebuilt" }));
}

export function ensureMcpConnectionSchema() {
  if (!schemaRepairPromise) {
    schemaRepairPromise = repairMcpConnectionSchema().catch((error) => {
      schemaRepairPromise = undefined;
      throw error;
    });
  }

  return schemaRepairPromise;
}

export const __mcpSchema = {
  ensureMcpConnectionSchema,
  hasUniqueShopConstraint,
  reset() {
    schemaRepairPromise = undefined;
  },
};
