export const config = {
  api: {
    bodyParser: false,
    responseLimit: false
  }
};

const BACKEND = "http://nl4.plugged.host:45340";

const HOP_HEADERS = new Set([
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
  "host",
  "content-length",
  "accept-encoding"
]);

export default async function handler(req, res) {
  try {
    const incoming = new URL(req.url, "https://proxy.local");

    // Original path aur query ko preserve karo.
    const target = new URL(BACKEND);
    target.pathname = incoming.pathname === "/api/proxy"
      ? "/"
      : incoming.pathname;
    target.search = incoming.search;

    const headers = new Headers();

    for (const [key, value] of Object.entries(req.headers)) {
      if (value == null || HOP_HEADERS.has(key.toLowerCase())) {
        continue;
      }

      headers.set(
        key,
        Array.isArray(value) ? value.join(", ") : value
      );
    }

    const hasBody = !["GET", "HEAD"].includes(req.method);

    const upstream = await fetch(target, {
      method: req.method,
      headers,
      body: hasBody ? req : undefined,
      duplex: hasBody ? "half" : undefined,
      redirect: "manual",
      signal: AbortSignal.timeout(25000)
    });

    res.statusCode = upstream.status;

    upstream.headers.forEach((value, key) => {
      const name = key.toLowerCase();

      if (
        HOP_HEADERS.has(name) ||
        name === "content-encoding" ||
        name === "content-length"
      ) {
        return;
      }

      if (name === "location") {
        try {
          const location = new URL(value, BACKEND);

          if (location.hostname === "nl4.plugged.host") {
            res.setHeader(
              "Location",
              location.pathname + location.search + location.hash
            );
            return;
          }
        } catch {}
      }

      res.setHeader(key, value);
    });

    if (!upstream.body) {
      return res.end();
    }

    const reader = upstream.body.getReader();

    while (true) {
      const { done, value } = await reader.read();

      if (done) break;

      if (!res.write(Buffer.from(value))) {
        await new Promise(resolve => res.once("drain", resolve));
      }
    }

    res.end();
  } catch (error) {
    console.error("Proxy failure:", error);

    if (!res.headersSent) {
      res.status(502).json({
        error: "Backend connection failed",
        message: error.message
      });
    } else {
      res.end();
    }
  }
        }
