import http from "node:http";
import { once } from "node:events";

/** Loopback only. No request is forwarded to a real provider. */
export async function fakeGatewayUpstream() {
  const requests = [];
  const state = { status: 200, body: null, disconnect: false };
  const server = http.createServer(async (request, response) => {
    let raw = "";
    for await (const chunk of request) raw += chunk;
    const body = raw ? JSON.parse(raw) : null;
    requests.push({ url: request.url, method: request.method, headers: request.headers, body });
    if (state.disconnect) return request.socket.destroy();
    if (state.status !== 200) {
      response.writeHead(state.status, { "Content-Type": "application/json" });
      response.end(
        JSON.stringify({ error: { message: `Do not expose ${request.headers.authorization}` } }),
      );
      return;
    }
    if (state.body !== null) {
      response.writeHead(200, { "Content-Type": "application/json" });
      response.end(state.body);
      return;
    }
    if (body?.stream) {
      response.writeHead(200, { "Content-Type": "text/event-stream" });
      const chunk = (delta, finish_reason = null) =>
        response.write(
          `data: ${JSON.stringify({
            id: "gateway-test",
            object: "chat.completion.chunk",
            created: 0,
            model: body.model,
            choices: [{ index: 0, delta, finish_reason }],
          })}\n\n`,
        );
      chunk({ role: "assistant", content: "OK" });
      if (body.tools?.length) {
        chunk({
          tool_calls: [
            {
              index: 0,
              id: "call_gateway",
              type: "function",
              function: { name: "gateway_probe", arguments: "" },
            },
          ],
        });
        chunk({ tool_calls: [{ index: 0, function: { arguments: '{"ok":' } }] });
        chunk({ tool_calls: [{ index: 0, function: { arguments: "true}" } }] });
      }
      chunk({}, body.tools?.length ? "tool_calls" : "stop");
      response.end("data: [DONE]\n\n");
      return;
    }
    response.writeHead(200, { "Content-Type": "application/json" });
    response.end(
      JSON.stringify({
        choices: [{ message: { role: "assistant", content: "OK" }, finish_reason: "stop" }],
      }),
    );
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  return {
    baseURL: `http://127.0.0.1:${server.address().port}/v1`,
    requests,
    state,
    close: () =>
      new Promise((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
        server.closeAllConnections();
      }),
  };
}
