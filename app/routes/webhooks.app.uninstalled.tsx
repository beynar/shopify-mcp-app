import type { ActionFunctionArgs } from "react-router";
import sessionStorage from "../session-storage.server";
import { authenticateWebhookRequest } from "../webhook-auth.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  const webhook = await authenticateWebhookRequest(request);
  if (webhook instanceof Response) {
    return webhook;
  }

  const { shop, session, topic } = webhook;

  console.log(`Received ${topic} webhook for ${shop}`);

  // Webhook requests can trigger multiple times and after an app has already been uninstalled.
  // If this webhook already ran, the session may have been deleted previously.
  if (session) {
    await sessionStorage.deleteSessionsByShop(shop);
  }

  return new Response();
};
