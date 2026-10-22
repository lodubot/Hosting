export const config = {
  api: { bodyParser: false, responseLimit: false },
  maxDuration: 60
};

const BACKEND = "http://nl4.plugged.host:45340";

const HOP_BY_HOP = new Set([
  "connection", "keep-alive", "proxy-authenticate",
  "proxy-authorization", "te", "trailer",
  "transfer-encoding", "upgrade"
]);

export default async function handler(req, res) {
  try {
    const incoming = new URL(req.url, "https://proxy.local");
    const target = new URL(BACKEND);
    target.pathname = incoming.pathname === "/api/proxy" ? "/" : incoming.pathname;
    target.search = incoming.search;

    const headers = new Headers();
    for (const [key, value] of Object.entries(req.headers)) {
      const name = key.toLowerCase();
      if (
        value == null ||
        name === "host" ||
        name === "accept-encoding" ||
        name === "origin" ||
        name === "referer" ||
        name.startsWith("x-vercel") ||
        name.startsWith("x-forwarded") ||
        HOP_BY_HOP.has(name)
      ) continue;
      // content-length ab forward hoga (upload ke liye zaroori)
      headers.set(key, Array.isArray(value) ? value.join(", ") : value);
    }

    headers.set("origin", BACKEND);
    headers.set("referer", BACKEND + "/");

    const hasBody = !["GET", "HEAD"].includes(req.method);
    const isUpload = hasBody &&
      (req.headers["content-type"] || "").includes("multipart/form-data");

    const response = await fetch(target, {
      method: req.method,
      headers,
      body: hasBody ? req : undefined,
      duplex: hasBody ? "half" : undefined,
      redirect: "manual",
      signal: AbortSignal.timeout(isUpload ? 55000 : 25000)
    });

    res.statusCode = response.status;

    for (const [key, value] of response.headers.entries()) {
      const name = key.toLowerCase();
      if (HOP_BY_HOP.has(name) || name === "content-encoding" || name === "content-length") continue;

      if (name === "location") {
        try {
          const redirect = new URL(value, BACKEND);
          if (redirect.hostname === new URL(BACKEND).hostname) {
            res.setHeader("Location", redirect.pathname + redirect.search + redirect.hash);
            continue;
          }
        } catch {}
      }
      res.setHeader(key, value);
    }

    if (!response.body) return res.end();

    const reader = response.body.getReader();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!res.write(Buffer.from(value))) {
        await new Promise(r => res.once("drain", r));
      }
    }
    res.end();
  } catch (error) {
    console.error("Proxy error:", error);
    if (!res.headersSent) {
      res.status(502).json({ error: "Backend proxy failed", message: error.message });
    } else {
      res.end();
    }
  }
}
