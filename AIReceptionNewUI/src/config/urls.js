// Central place for API URLs and future endpoints.
// Use environment variables to override defaults when needed.

const API_PROXY_BASE =
  import.meta.env.VITE_API_PROXY_BASE ?? "/api";

export const API_URLS = {
  crawlKnowledgeBase: `${API_PROXY_BASE}/crawl-kb`
};

export default API_URLS;
