// Backend Phase 8 — SSRF protection for outbound webhooks.
//
// A destination must be HTTPS (plain HTTP only for explicitly allowed local
// development), carry no credentials, and resolve ONLY to public addresses:
// loopback, private, link-local, carrier-grade NAT, documentation,
// benchmarking, multicast and reserved ranges are refused (IPv4, IPv6 and
// IPv4-mapped IPv6). DNS is resolved by us and the connection is pinned to
// the address we validated, so a rebinding DNS answer can't swap in an
// internal address between the check and the request. Redirects are
// followed manually (at most 3), each one re-validated.
import dns from "node:dns/promises";
import net from "node:net";
import http from "node:http";
import https from "node:https";

const V4_BLOCKED = [
  ["0.0.0.0", 8], ["10.0.0.0", 8], ["100.64.0.0", 10], ["127.0.0.0", 8], ["169.254.0.0", 16], ["172.16.0.0", 12], ["192.0.0.0", 24], ["192.0.2.0", 24],
  ["192.88.99.0", 24], ["192.168.0.0", 16], ["198.18.0.0", 15], ["198.51.100.0", 24], ["203.0.113.0", 24], ["224.0.0.0", 4], ["240.0.0.0", 4], ["255.255.255.255", 32],
];
const v4ToInt = (ip) => ip.split(".").reduce((n, o) => (n << 8) + Number(o), 0) >>> 0;
const inV4 = (ip, [base, bits]) => bits === 0 || ((v4ToInt(ip) ^ v4ToInt(base)) >>> (32 - bits)) === 0;

export function isBlockedAddress(address) {
  if (net.isIPv4(address)) return V4_BLOCKED.some((r) => inV4(address, r));
  if (!net.isIPv6(address)) return true;
  const a = address.toLowerCase();
  const mapped = a.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped) return isBlockedAddress(mapped[1]);
  if (a === "::" || a === "::1") return true;
  const first = parseInt(a.split(":")[0] || "0", 16);
  if ((first & 0xfe00) === 0xfc00) return true; // fc00::/7 unique local
  if ((first & 0xffc0) === 0xfe80) return true; // fe80::/10 link-local
  if ((first & 0xff00) === 0xff00) return true; // ff00::/8 multicast
  if (a.startsWith("2001:db8:") || a.startsWith("2001:0db8:")) return true; // documentation
  if (a.startsWith("64:ff9b:")) return true; // NAT64 → could reach IPv4 private space
  return false;
}

export class SsrfError extends Error {}

export const allowLocalTargets = () => process.env.NODE_ENV !== "production" && process.env.INTEGRATIONS_ALLOW_PRIVATE_WEBHOOK_TARGETS === "true";

export function validateDestinationUrl(raw, { allowLocal = allowLocalTargets() } = {}) {
  let u;
  try { u = new URL(raw); } catch { throw new SsrfError("The URL is not valid."); }
  if (u.protocol !== "https:" && !(allowLocal && u.protocol === "http:")) throw new SsrfError("Webhook URLs must use HTTPS.");
  if (u.username || u.password) throw new SsrfError("Webhook URLs can't contain credentials.");
  if (u.port && !["443", "8443"].includes(u.port) && !allowLocal) throw new SsrfError("Only ports 443 and 8443 are allowed.");
  const host = u.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (!allowLocal && (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || host.endsWith(".internal"))) throw new SsrfError("That host isn't allowed.");
  if (net.isIP(host) && isBlockedAddress(host) && !allowLocal) throw new SsrfError("That address is private or reserved.");
  return u;
}

// Resolves every address and refuses the host if ANY of them is blocked.
export async function resolvePublic(hostname, { resolver = dns.lookup, allowLocal = allowLocalTargets() } = {}) {
  const host = hostname.replace(/^\[|\]$/g, "");
  const addresses = net.isIP(host) ? [{ address: host, family: net.isIP(host) }] : await resolver(host, { all: true, verbatim: true });
  if (!addresses.length) throw new SsrfError("The host doesn't resolve.");
  if (!allowLocal && addresses.some((a) => isBlockedAddress(a.address))) throw new SsrfError("The host resolves to a private or reserved address.");
  return addresses[0];
}

// One request to a validated, pinned address. Response bodies are read up
// to a small limit and discarded (we keep only status and timing).
function requestOnce(u, pinned, { method, headers, body, timeoutMs }) {
  return new Promise((resolve, reject) => {
    const lib = u.protocol === "https:" ? https : http;
    const req = lib.request({
      protocol: u.protocol, hostname: u.hostname, port: u.port || (u.protocol === "https:" ? 443 : 80), path: `${u.pathname}${u.search}`, method, headers,
      servername: net.isIP(u.hostname) ? undefined : u.hostname,
      // Pin: the socket connects to the address we validated, whatever DNS says now.
      lookup: (_host, opts, cb) => (opts && opts.all ? cb(null, [{ address: pinned.address, family: pinned.family }]) : cb(null, pinned.address, pinned.family)),
      timeout: timeoutMs,
    }, (res) => {
      let size = 0;
      res.on("data", (chunk) => { size += chunk.length; if (size > 65_536) res.destroy(); });
      res.on("end", () => resolve({ status: res.statusCode, location: res.headers.location || null }));
      res.on("close", () => resolve({ status: res.statusCode, location: res.headers.location || null }));
    });
    req.on("timeout", () => req.destroy(new Error("timeout")));
    req.on("error", reject);
    if (body) req.write(body);
    req.end();
  });
}

export async function safeDeliver(url, { method = "POST", headers = {}, body = null, timeoutMs = 5000, maxRedirects = 3, resolver, allowLocal = allowLocalTargets(), send = requestOnce } = {}) {
  let current = validateDestinationUrl(url, { allowLocal });
  for (let hop = 0; hop <= maxRedirects; hop += 1) {
    const pinned = await resolvePublic(current.hostname, { resolver, allowLocal });
    const res = await send(current, pinned, { method, headers: { ...headers, Host: current.host }, body, timeoutMs });
    if (res.status >= 300 && res.status < 400 && res.location) {
      if (hop === maxRedirects) throw new SsrfError("Too many redirects.");
      current = validateDestinationUrl(new URL(res.location, current).toString(), { allowLocal });
      continue;
    }
    return { status: res.status };
  }
  throw new SsrfError("Too many redirects.");
}
