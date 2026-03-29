create table if not exists __new_McpConnection (
  key text primary key not null,
  shop text not null unique,
  sessionId text not null,
  createdAt integer not null,
  updatedAt integer not null
);

insert into __new_McpConnection (key, shop, sessionId, createdAt, updatedAt)
select key, shop, sessionId, createdAt, updatedAt
from (
  select
    key,
    shop,
    sessionId,
    createdAt,
    updatedAt,
    row_number() over (
      partition by shop
      order by updatedAt desc, createdAt desc, key desc
    ) as rowNumber
  from McpConnection
)
where rowNumber = 1
on conflict(shop) do update set
  key = excluded.key,
  sessionId = excluded.sessionId,
  createdAt = excluded.createdAt,
  updatedAt = excluded.updatedAt;

drop table if exists McpConnection;
alter table __new_McpConnection rename to McpConnection;
