export const config = {
  api: {
    bodyParser: false
  }
};

export default async function handler(req, res) {
  const targetHost = "nl4.plugged.host";
  const targetPort = "45340";

  try {
    const requestedPath = Array.isArray(req.query.path)
      ? req.query.path.join("/")
      : (req.query.path || "");

    const queryIndex = req.url.indexOf("?");
    let queryString = "";

    if (queryIndex !== -1) {
      queryString = req.url.slice(queryIndex + 1);
      queryString = queryString
        .replace(/(^|&)path=[^&]*/, "")
        .replace(/^&|&$/g, "");
    }

    const targetUrl =
      `http://${targetHost}:${targetPort}/${requestedPath}` +
      (queryString ? `?${queryString}` : "");

    const headers = { ...req.headers };

    delete headers.host;
    delete headers.connection;
    delete headers["content-length"];
    delete headers["accept-encoding"];

    const chunks = [];

    for await (const chunk of req) {
      chunks.push(chunk);
    }

    const body = ["GET", "HEAD"].includes(req.method)
      ? undefined
      : Buffer.concat(chunks);

    const upstream = await fetch(targetUrl, {
      method: req.method,
      headers,
      body,
      redirect: "manual",
      signal: AbortSignal.timeout(25000)
    });

    res.statusCode = upstream.status;

    const excludedHeaders = [
      "transfer-encoding",
      "connection",
      "content-encoding",
      "content-length"
    ];

    upstream.headers.forEach((value, name) => {
      if (!excludedHeaders.includes(name.toLowerCase())) {
        res.setHeader(name, value);
      }
    });

    const data = Buffer.from(await upstream.arrayBuffer());
    res.end(data);

  } catch (error) {
    console.error("Proxy error:", error.message);

    res.status(502).json({
      error: "Backend connection failed",
      message: "Original hosting server se connection nahi ho paya."
    });
  }
}
