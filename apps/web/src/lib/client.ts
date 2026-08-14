export type ClientContext = {
  clientSlug: string | null;
  hostname: string;
  isIdoxsDomain: boolean;
};

const ROOT_DOMAINS = ['idoxs.app'];

export function getClientContext(hostname = window.location.hostname): ClientContext {
  const normalized = hostname.toLowerCase();
  const rootDomain = ROOT_DOMAINS.find((domain) => normalized === domain || normalized.endsWith(`.${domain}`));
  const isIdoxsDomain = Boolean(rootDomain);

  if (!rootDomain || normalized === rootDomain) {
    return { clientSlug: null, hostname: normalized, isIdoxsDomain };
  }

  const labels = normalized.slice(0, -(rootDomain.length + 1)).split('.');
  const clientSlug = labels[labels.length - 1] || null;
  return { clientSlug, hostname: normalized, isIdoxsDomain };
}

export function getDisplayClientName(clientSlug: string | null) {
  if (!clientSlug) return 'iDOXS';
  return clientSlug
    .split('-')
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}
