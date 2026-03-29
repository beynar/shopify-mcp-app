import { authenticate } from "./shopify.server";

export type AuthenticatedWebhook = Awaited<ReturnType<typeof authenticate.webhook>>;

/**
 * Preserve Shopify's webhook auth responses so invalid requests return 401/400/405
 * instead of bubbling into the app error boundary as 500s.
 */
export async function authenticateWebhookRequest(
  request: Request,
): Promise<AuthenticatedWebhook | Response> {
  try {
    return await authenticate.webhook(request.clone() as Request);
  } catch (error) {
    if (error instanceof Response) {
      return error;
    }
    throw error;
  }
}
