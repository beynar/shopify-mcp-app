# Query: `shopifyqlQuery` — Verified ShopifyQL Reference

ShopifyQL is Shopify's analytics query language for aggregated commerce reporting. This reference is based on empirical API testing against `harmony-nutri-dev.myshopify.com` on the `Basic` plan with Admin API version `2026-04`. It intentionally corrects several claims from the official docs that do not hold for the GraphQL API on this plan.

## GraphQL Integration

Execute ShopifyQL through the GraphQL `shopifyqlQuery` field and pass the ShopifyQL string through a GraphQL variable.

```graphql
query ShopifyQL($q: String!) {
  shopifyqlQuery(query: $q) {
    parseErrors
    tableData {
      columns {
        name
        dataType
        displayName
      }
      rows
    }
  }
}
```

```json
{
  "q": "FROM sales SHOW total_sales, orders SINCE -7d UNTIL today GROUP BY day ORDER BY day ASC"
}
```

Key points:
- Always check `parseErrors` first. If it is non-empty, the query failed and `tableData` may be `null`.
- Results live in `tableData.rows`, which is an array of row objects keyed by column name.
- `tableData.columns` gives metadata for those row keys.
- Pass the ShopifyQL string as `$q`; do not inline it into the GraphQL document.

## Required scope

`read_reports`

## Keyword Order

Core syntax:

```shopifyql
FROM <dataset>
  SHOW <metric_or_dimension>[, ...]
  [WHERE <dimension_filter>]
  [GROUP BY <dimension>[, ...]]
  [TIMESERIES <time_dimension>]
  [SINCE <date_or_offset>]
  [UNTIL <date_or_offset>]
  [DURING <named_range>]
  [COMPARE TO <period_or_date>]
  [HAVING <metric_filter>]
  [ORDER BY <column> ASC|DESC]
  [LIMIT <n>]
  [WITH <modifier>]
```

Mandatory keyword order:

1. `FROM`
2. `SHOW`
3. `WHERE`
4. `GROUP BY`
5. `TIMESERIES`
6. `SINCE`
7. `UNTIL`
8. `DURING`
9. `COMPARE TO`
10. `HAVING`
11. `ORDER BY`
12. `LIMIT`
13. `WITH`

Rules that actually matter:
- Metrics are pre-aggregated. Do not wrap them in `sum()`, `count()`, or `avg()`.
- `SHOW *` is invalid. Name columns explicitly.
- String literals use single quotes.
- `WHERE` filters dimensions only. Use `HAVING` for metric filters.
- `TIMESERIES` replaces `GROUP BY` for the time dimension and fills gaps with zero rows.
- `DURING` cannot be combined with `SINCE` / `UNTIL`.
- Only one `WITH` clause is valid.
- `VISUALIZE` is not supported through the GraphQL API. It works in the Shopify admin UI, not here.

## Working Datasets

### sales

Default dataset for analytics on Basic. Use this for revenue, orders, customer counts, product analytics, and most report-style questions.

Verified metrics:
- `total_sales`
- `net_sales`
- `gross_sales`
- `gross_profit`
- `orders`
- `customers`
- `new_customers`
- `returning_customers`
- `average_order_value`
- `returns`
- `discounts`
- `taxes`
- `tips`

Verified dimensions:
- `product_title`
- `product_type`
- `product_vendor`
- `product_id`
- `product_tag`
- `billing_country`
- `billing_region`
- `shipping_country`
- `shipping_region`
- `discount_code`
- `sales_channel`
- `pos_location_name`
- `order_name`
- `shop_name`
- `shop_id`

Verified time dimensions:
- `second`
- `minute`
- `hour`
- `day`
- `week`
- `month`
- `quarter`
- `year`
- `hour_of_day`
- `day_of_week`
- `week_of_year`
- `month_of_year`

Examples:

```shopifyql
FROM sales
  SHOW total_sales, net_sales, orders
  SINCE -30d
  UNTIL today
  GROUP BY day
  ORDER BY day ASC
```

```shopifyql
FROM sales
  SHOW total_sales, orders
  GROUP BY product_title
  ORDER BY total_sales DESC
  LIMIT 10
  SINCE -30d
```

### sessions

Use for traffic and attribution analytics.

Verified metrics:
- `sessions`
- `conversion_rate`
- `bounce_rate`
- `average_session_duration`

Verified dimensions:
- `referrer_source`
- `referrer_name`
- `referrer_path`
- `landing_page_path`
- `utm_campaign`
- `utm_source`
- `utm_medium`
- `utm_content`
- `utm_term`

Examples:

```shopifyql
FROM sessions
  SHOW sessions, conversion_rate
  GROUP BY day
  SINCE -30d
  ORDER BY day ASC
```

```shopifyql
FROM sessions
  SHOW sessions
  GROUP BY utm_campaign
  SINCE -30d
  ORDER BY sessions DESC
```

### customers

Useful for customer listing and spend analysis. On Basic, this dataset is more constrained than `sales`.

Verified metric:
- `total_amount_spent`

Verified dimensions:
- `customer_email`
- `customer_id`
- `customer_name`
- `customer_tag`
- `customer_language`
- `customer_country`
- `customer_region`
- `customer_city`
- `customer_account_status`

Important constraint:
- When grouping by customer dimensions, `customer_email` must be included in `GROUP BY`.

Example:

```shopifyql
FROM customers
  SHOW total_amount_spent
  GROUP BY customer_email, customer_name, customer_country
  SINCE -90d
  ORDER BY total_amount_spent DESC
  LIMIT 20
```

### payment_attempts

Very limited on Basic, but partially usable.

Verified metric:
- `successful_payments`

Verified dimension:
- `payment_method`

Example:

```shopifyql
FROM payment_attempts
  SHOW successful_payments
  GROUP BY payment_method
  SINCE -30d
  ORDER BY successful_payments DESC
```

### inventory

`FROM inventory` is accepted, but no working metrics were verified on Basic. Treat it as unavailable for practical reporting on this plan.

## Invalid Or Misleading Official-Docs Paths

These are the biggest traps:
- `FROM products` does not work here. Use `FROM sales GROUP BY product_title` for product analytics.
- `FROM orders` does not work on Basic. Use `FROM sales` for aggregate order metrics, or the Admin GraphQL `orders` query for order-level detail.
- `FROM returns`, `FROM visits`, `FROM traffic`, `FROM marketing`, and `FROM behaviors` are invalid in this tested environment.

## Time Filtering

Supported relative offsets:
- `-7d`
- `-30d`
- `-4w`
- `-3m`
- `-1q`
- `-1y`

Absolute dates:

```shopifyql
FROM sales SHOW total_sales SINCE 2026-04-01 UNTIL 2026-06-01
```

Named date values for `SINCE` / `UNTIL`:
- `today`
- `yesterday`

Supported `DURING` ranges:
- `this_week`
- `last_week`
- `this_weekend`
- `last_weekend`
- `this_month`
- `last_month`
- `this_quarter`
- `last_quarter`
- `this_year`
- `last_year`

## WHERE Clause

`WHERE` supports:
- `=`
- `!=`
- `<`
- `>`
- `<=`
- `>=`
- `STARTS WITH`
- `ENDS WITH`
- `CONTAINS`
- `AND`
- `OR`
- `NOT`

Examples:

```shopifyql
FROM sales SHOW total_sales WHERE billing_country = 'FR' SINCE -30d
```

```shopifyql
FROM sales SHOW total_sales WHERE product_title CONTAINS 'Vitamin' SINCE -30d
```

## HAVING Clause

`HAVING` supports metric filters after aggregation:

```shopifyql
FROM sales
  SHOW total_sales
  GROUP BY product_title
  HAVING total_sales > 0
  ORDER BY total_sales DESC
```

## MATCHES Semi-Joins

`MATCHES` is documented by Shopify, but in the tested Basic-plan GraphQL setup it returned `Schema Not Matchable`. Treat it as unavailable here unless you verify it on the target store and plan.

Documented `MATCHES` expressions include:
- `products_purchased(...)`
- `orders_placed(...)`
- `shopify_email.opened(...)`
- `shopify_email.clicked(...)`
- storefront activity predicates

## Visualization Types

`VISUALIZE` is not supported through the GraphQL API. Do not include visualization clauses in `shopifyqlQuery` requests, even though Shopify admin UI examples may show them.

## Segment Query Language

Customer segmentation syntax is documented by Shopify as a WHERE-only subset of ShopifyQL, but the tested Basic-plan GraphQL setup did not make that path usable enough to treat it as a reliable API feature. For practical analytics on Basic, prefer `FROM sales` and `FROM customers` patterns that were verified directly.

## Common Segment Patterns

- high-value customers by spend and order count
- recent engaged customers
- new customers in the last 30 days
- at-risk customers based on last order date

## Common Mistakes

- Using `FROM products` because the official docs mention it.
- Using `SHOW *`.
- Using `VISUALIZE` in the GraphQL API.
- Filtering metrics in `WHERE` instead of `HAVING`.
- Combining `DURING` with `SINCE` / `UNTIL`.
- Using multiple `WITH` clauses.

## TIMESERIES, COMPARE TO, WITH

`TIMESERIES` examples:

```shopifyql
FROM sales
  SHOW total_sales
  TIMESERIES day
  SINCE -30d
  UNTIL today
```

```shopifyql
FROM sales
  SHOW total_sales
  GROUP BY product_title
  TIMESERIES day
  SINCE -7d
  UNTIL today
  LIMIT 10
```

`COMPARE TO` values verified here:
- `previous_period`
- `last_year`
- absolute date comparison

Example:

```shopifyql
FROM sales
  SHOW total_sales
  GROUP BY day
  SINCE -7d
  UNTIL today
  COMPARE TO previous_period
```

Valid `WITH` modifiers:
- `WITH TOTALS`
- `WITH GROUP_TOTALS`
- `WITH PERCENT_CHANGE`
- `WITH CUMULATIVE_VALUES`
- `WITH CURRENCY 'EUR'`
- `WITH TIMEZONE 'America/New_York'`

Only one `WITH` clause is valid.

## Metafields

Metafields can be used in `WHERE`, `GROUP BY`, and `SHOW`.

Reference format:

```text
{owner_type}.metafields.{namespace}.{key}
```

Supported owner types:
- `customer`
- `order`
- `product`
- `product_variant`

## Critical Gotchas

- Do not trust every column listed in the official ShopifyQL docs for Basic-plan GraphQL usage.
- Columns such as `revenue`, `shipping`, `units_sold`, `sales_reversals`, `channel_name`, `referrer_source`, and several session/customer fields are documented upstream but returned `Column Not Found` in the tested API context.
- `MATCHES` semi-joins are documented, but on this tested Basic-plan setup they returned `Schema Not Matchable`.
- For customer counts, new customers, and returning customers, prefer the `sales` dataset instead of trying to force the `customers` dataset into aggregate analytics.

## Recommended Defaults

When in doubt:
- use `FROM sales` first
- group by `day`, `month`, `product_title`, or geography dimensions
- use `sessions` only for traffic/attribution
- use Admin GraphQL queries, not ShopifyQL, for order-level detail and write operations
