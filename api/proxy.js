export const config = {
  api: {
    bodyParser: false,
    responseLimit: false
  }
};

export default async function handler(req, res) {
  const TARGET = "http://nl4.plugged.host:45340";

  try {
    // Original request ka path aur query preserve karo.
    const originalUrl = new URL(req.url, "https://proxy.local");
    let requestedPath = originalUrl.pathname;

    // /api/proxy endpoint ko backend ke root se map karo.
    if (requestedPath === "/api/proxy") {
      requestedPath = "/";
    }

    const targetUrl = new URL(
      TARGET + requestedPath + originalUrl.search
    );

    const headers = new Headers();

    for (const [name, value] of Object.entries(req.headers)) {
      if (
        value &&
        ![
          "host",
          "connection",
          "content-length",
          "transfer-encoding",
          "accept-encoding"
        ].includes(name.toLowerCase())
      ) {
        headers.set(
          name,
          Array.isArray(value) ? value.join(", ") : value
        );
      }
    }

    // Stream request body instead of buffering the entire upload.
    const hasBody = !["GET", "HEAD"].includes(req.method);

    const upstream = await fetch(targetUrl, {
      method: req.method,
      headers,
      body: hasBody ? req : undefined,
      duplex: hasBody ? "half" : undefined,
      redirect: "manual",
      signal: AbortSignal.timeout(25000)
    });

    res.statusCode = upstream.status;

    // Forward response headers.
    upstream.headers.forEach((value, name) => {
      const lower = name.toLowerCase();

      if (
        ![
          "connection",
          "transfer-encoding",
          "content-encoding",
          "content-length"
        ].includes(lower)
      ) {
        res.setHeader(name, value);
      }
    });

    // Redirects may expose the backend hostname, so rewrite local redirects.
    const location = upstream.headers.get("location");

    if (location) {
      try {
        const redirectUrl = new URL(location, TARGET);

        if (redirectUrl.hostname === "nl4.plugged.host") {
          res.setHeader(
            "location",
            redirectUrl.pathname + redirectUrl.search + redirectUrl.hash
          );
        }
      } catch {
        // Keep the response even if Location is not a valid URL.
      }
    }

    if (!upstream.body) {
      return res.end();
    }

    // Stream response back to the browser.
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
    console.error("Proxy error:", error);

    if (!res.headersSent) {
      res.status(502).json({
        error: "Proxy request failed",
        details: error.message
      });
    } else {
      res.end();
    }
  }
}
