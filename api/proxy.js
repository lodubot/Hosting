export const config = {
  api: { bodyParser: false, responseLimit: false }
};

const BACKEND = process.env.BACKEND; // http://nl4.plugged.host:45340
const BACKEND_HOST = BACKEND ? new URL(BACKEND).hostname : "";

const HOP = new Set([
  "connection", "keep-alive", "proxy-authenticate",
  "proxy-authorization", "te", "trailer",
  "transfer-encoding", "upgrade"
]);

const safeDecode = s => {
  try { return decodeURIComponent(s); } catch { return s; }
};

export default async function handler(req, res) {
  try {
    if (!BACKEND) throw new Error("BACKEND env missing");

    const incoming = new URL(req.url, "https://proxy.local");

    // Original path sirf __vp se lo, aur use query se hata do
    const vp = incoming.searchParams.get("__vp") || "";
    incoming.searchParams.delete("__vp");

    const cleanPath = vp
      .split("/")
      .filter(Boolean)
      .map(s => encodeURIComponent(safeDecode(s)))
      .join("/");

    const qs = incoming.searchParams.toString();
    const target = new URL(BACKEND);
    target.pathname = "/" + cleanPath;
    target.search = qs ? "?" + qs : "";

    const headers = new Headers();
    for (const [key, value] of Object.entries(req.headers)) {
      const n = key.toLowerCase();
      if (
        value == null || HOP.has(n) ||
        n === "host" || n === "accept-encoding" ||
        n === "origin" || n === "referer" ||
        n.startsWith("x-vercel") || n.startsWith("x-forwarded")
      ) continue;
      headers.set(key, Array.isArray(value) ? value.join(", ") : value);
    }
    headers.set("origin", BACKEND);
    headers.set("referer", BACKEND + "/");

    const hasBody = !["GET", "HEAD"].includes(req.method);

    const upstream = await fetch(target, {
      method: req.method,
      headers,
      body: hasBody ? req : undefined,
      duplex: hasBody ? "half" : undefined,
      redirect: "manual",
      signal: AbortSignal.timeout(28000)
    });

    res.statusCode = upstream.status;

    upstream.headers.forEach((value, key) => {
      const n = key.toLowerCase();
      if (
        HOP.has(n) || n === "content-encoding" ||
        n === "content-length" || n === "set-cookie" ||
        n === "server" || n === "x-powered-by"
      ) return;

      if (n === "location") {
        try {
          const l = new URL(value, BACKEND);
          if (l.hostname === BACKEND_HOST) {
            res.setHeader("Location", l.pathname + l.search + l.hash);
            return;
          }
        } catch {}
      }
      res.setHeader(key, value);
    });

    const cookies = upstream.headers.getSetCookie?.() || [];
    if (cookies.length) {
      res.setHeader(
        "Set-Cookie",
        cookies.map(c => c.replace(/;\s*domain=[^;]+/i, ""))
      );
    }

    if (!upstream.body) return res.end();

    const reader = upstream.body.getReader();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!res.write(Buffer.from(value))) {
        await new Promise(r => res.once("drain", r));
      }
    }
    res.end();
  } catch (error) {
    console.error("Proxy failure:", error); // sirf Vercel logs mein
    if (!res.headersSent) {
      res.status(502).json({ error: "Service unavailable" });
    } else {
      res.end();
    }
  }
}
