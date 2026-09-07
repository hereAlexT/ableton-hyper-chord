// A tiny local HTTP server that pushes results to a browser tab over
// Server-Sent Events. The SDK has no live selection events, so this does not
// make the panel "live" by itself — but every right-click result lands here
// without a modal dialog, and the tab can sit on a second screen.

import * as http from "node:http";
import { spawn } from "node:child_process";

import panelHtml from "./panel.html";
import type { ChordListDialog } from "./dialogs.js";

export class Panel {
  private server: http.Server | null = null;
  private readonly clients = new Set<http.ServerResponse>();
  private last: ChordListDialog | null = null;
  private port: number;

  constructor(port: number) {
    this.port = port;
  }

  get url(): string {
    return `http://localhost:${this.port}/`;
  }

  get running(): boolean {
    return this.server !== null;
  }

  async start(): Promise<string> {
    if (this.server) return this.url;
    const server = http.createServer((req, res) => this.handle(req, res));
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(this.port, "127.0.0.1", () => {
        server.off("error", reject);
        resolve();
      });
    });
    server.unref();
    this.server = server;
    console.log(`hyper-chord: panel at ${this.url}`);
    return this.url;
  }

  stop(): void {
    for (const c of this.clients) c.end();
    this.clients.clear();
    this.server?.close();
    this.server = null;
  }

  /** Broadcast to connected tabs; a no-op when the server isn't running. */
  publish(event: ChordListDialog): void {
    this.last = event;
    if (!this.server) return;
    const data = `data: ${JSON.stringify(event)}\n\n`;
    for (const c of this.clients) c.write(data);
  }

  /** Best-effort: open the panel in the default browser. */
  openInBrowser(): void {
    try {
      const cmd = process.platform === "darwin" ? "open" : process.platform === "win32" ? "cmd" : "xdg-open";
      const args = process.platform === "win32" ? ["/c", "start", "", this.url] : [this.url];
      const child = spawn(cmd, args, { stdio: "ignore", detached: true });
      child.on("error", (e) => console.warn("hyper-chord: could not open browser:", e.message));
      child.unref();
    } catch (error) {
      console.warn("hyper-chord: could not open browser:", error);
    }
  }

  private handle(req: http.IncomingMessage, res: http.ServerResponse): void {
    const url = req.url ?? "/";
    if (url === "/events") {
      res.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      });
      res.write(": hello\n\n");
      if (this.last) res.write(`data: ${JSON.stringify(this.last)}\n\n`);
      this.clients.add(res);
      req.on("close", () => this.clients.delete(res));
      return;
    }
    if (url === "/" || url === "/index.html") {
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(panelHtml);
      return;
    }
    if (url === "/last.json") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(this.last ?? {}));
      return;
    }
    res.writeHead(404);
    res.end();
  }
}
