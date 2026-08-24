#!/usr/bin/env node
/** Local/dev/Node-host entry for the relay. Zero dependencies (Node 18+). */
import { createServer } from "node:http";
import { handle } from "./relay.mjs";

const port = Number(process.env.PORT || 8787);

const server = createServer(async (req, res) => {
  try {
    const headers = {};
    for (const [k, v] of Object.entries(req.headers)) {
      if (!["host", "connection", "content-length", "accept-encoding"].includes(k)) headers[k] = v;
    }
    let body;
    if (req.method === "POST") {
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      body = Buffer.concat(chunks);
    }
    const request = new Request(`http://localhost:${port}${req.url}`, {
      method: req.method,
      headers,
      body,
    });
    const resp = await handle(request, process.env);
    res.writeHead(resp.status, Object.fromEntries(resp.headers));
    if (resp.body) {
      for await (const chunk of resp.body) res.write(chunk);
    }
    res.end();
  } catch (e) {
    res.writeHead(500, { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" });
    res.end(JSON.stringify({ error: e.message }));
  }
});

server.listen(port, () => {
  console.log(`agi-eval relay listening on http://localhost:${port}`);
  console.log(process.env.ACCESS_CODE ? "ACCESS_CODE gate: ON" : "ACCESS_CODE gate: off (local use)");
});
