import type { ActionFunctionArgs } from "react-router";

import { purgeShopData } from "../mcp-connection.server";
import { revokeOauthGrantsForShop } from "../mcp-oauth.server";
import type { WorkerEnv } from "../mcp.server";
import { authenticateWebhookRequest } from "../webhook-auth.server";

function getWorkerEnv(
  context: ActionFunctionArgs["context"],
): WorkerEnv | undefined {
  const cloudflare = (context as { cloudflare?: { env?: WorkerEnv } } | undefined)?.cloudflare;
  return cloudflare?.env;
}

export const action = async ({ request, context }: ActionFunctionArgs) => {
  const webhook = await authenticateWebhookRequest(request);
  if (webhook instanceof Response) {
    return webhook;
  }

  const { shop, topic } = webhook;

  if (topic === "customers/data_request" || topic === "customers/redact") {
    console.log(`Received compliance webhook ${topic} for ${shop}`);
    return new Response(null, { status: 200 });
  }

  if (topic === "shop/redact") {
    console.log(`Received compliance webhook ${topic} for ${shop}`);
    await purgeShopData(shop);

    const env = getWorkerEnv(context);
    if (env) {
      await revokeOauthGrantsForShop(env, shop);
    } else {
      console.warn(`Unable to revoke OAuth grants for ${shop}: Cloudflare env missing in action context.`);
    }

    return new Response(null, { status: 200 });
  }

  console.warn(`Unhandled compliance webhook topic ${topic} for ${shop}`);
  return new Response("Unhandled compliance webhook topic", { status: 400 });
};
