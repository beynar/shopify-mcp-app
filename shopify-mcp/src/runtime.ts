export type AssetEnv = {
  ASSETS: Fetcher;
  LOADER: WorkerLoader;
};

export type ShopifyAdminCredentials = {
  shopDomain: string;
  adminAccessToken: string;
  apiVersion: string;
};
