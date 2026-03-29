import type { ActionFunctionArgs } from "react-router";
import sessionStorage from "../session-storage.server";
import { authenticateWebhookRequest } from "../webhook-auth.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  const webhook = await authenticateWebhookRequest(request);
  if (webhook instanceof Response) {
    return webhook;
  }

  const { payload, session, topic, shop } = webhook;
  console.log(`Received ${topic} webhook for ${shop}`);

  const current = payload.current as string[];
  if (session) {
    await sessionStorage.updateScope(session.id, current.toString());
  }
  return new Response();
};
