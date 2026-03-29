const pageStyle = {
  margin: "0 auto",
  maxWidth: "780px",
  padding: "48px 20px 72px",
  color: "#111827",
} as const;

const leadStyle = {
  color: "#4b5563",
  fontSize: "18px",
  lineHeight: 1.6,
  margin: "0 0 32px",
} as const;

const sectionStyle = {
  marginTop: "32px",
} as const;

const listStyle = {
  color: "#374151",
  lineHeight: 1.7,
  paddingLeft: "20px",
} as const;

export default function PrivacyPage() {
  return (
    <main style={pageStyle}>
      <p style={{ color: "#6b7280", fontSize: "14px", margin: "0 0 12px" }}>Last updated: March 27, 2026</p>
      <h1 style={{ fontSize: "40px", lineHeight: 1.1, margin: "0 0 16px" }}>Privacy Policy</h1>
      <p style={leadStyle}>
        This privacy policy explains how Connector handles merchant and shop data when the app is installed and used
        through Shopify.
      </p>

      <section style={sectionStyle}>
        <h2 style={{ fontSize: "24px", margin: "0 0 12px" }}>What we collect</h2>
        <ul style={listStyle}>
          <li>Shop information provided by Shopify during authentication, such as the shop domain and installation context.</li>
          <li>Access tokens and session data required to call Shopify APIs on behalf of the merchant.</li>
          <li>MCP connection metadata generated to let the merchant connect the app to supported MCP clients.</li>
          <li>Operational logs and basic diagnostic data needed to secure, monitor, and troubleshoot the service.</li>
        </ul>
      </section>

      <section style={sectionStyle}>
        <h2 style={{ fontSize: "24px", margin: "0 0 12px" }}>How we use data</h2>
        <ul style={listStyle}>
          <li>To authenticate merchants and maintain secure app sessions.</li>
          <li>To execute Shopify API requests initiated by the merchant through the app or connected MCP clients.</li>
          <li>To generate and manage MCP connection URLs and secrets.</li>
          <li>To maintain service reliability, prevent abuse, and investigate incidents.</li>
        </ul>
      </section>

      <section style={sectionStyle}>
        <h2 style={{ fontSize: "24px", margin: "0 0 12px" }}>How data is stored</h2>
        <p style={{ color: "#374151", lineHeight: 1.7, margin: 0 }}>
          App data is stored in infrastructure used to operate the service, including Cloudflare-hosted databases, key-value
          storage, and worker runtime secrets. We retain data only for as long as it is needed to operate the app, satisfy
          security requirements, and comply with legal obligations.
        </p>
      </section>

      <section style={sectionStyle}>
        <h2 style={{ fontSize: "24px", margin: "0 0 12px" }}>Sharing</h2>
        <p style={{ color: "#374151", lineHeight: 1.7, margin: 0 }}>
          We do not sell merchant data. Data is shared only with service providers and infrastructure platforms required to run
          the app, or when required by law.
        </p>
      </section>

      <section style={sectionStyle}>
        <h2 style={{ fontSize: "24px", margin: "0 0 12px" }}>Requests</h2>
        <p style={{ color: "#374151", lineHeight: 1.7, margin: 0 }}>
          For privacy or data access requests related to Connector, use the support channel associated with the app installation
          or the Shopify Partner contact path for the app publisher.
        </p>
      </section>
    </main>
  );
}
