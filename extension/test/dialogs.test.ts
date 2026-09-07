import * as vm from "node:vm";
import { describe, expect, it } from "vitest";

import { renderDialogHtml } from "../src/ui/dialogs.js";

/** Pull the first inline <script> out of the page and make sure it parses. */
function firstScript(html: string): string {
  const m = /<script>([\s\S]*?)<\/script>/.exec(html);
  if (!m) throw new Error("no script");
  return m[1]!;
}

describe("dialog rendering", () => {
  it("injects the data where the placeholder is and keeps the script valid", () => {
    const html = renderDialogHtml({ title: "Am7", subtitle: "Piano · C Major", keys: ["start", "end", "chord"], rows: [{ start: "1", end: "2", chord: "Am7 (vi7)" }] });
    expect(html).not.toContain("__HYPERCHORD_DATA__");
    const script = firstScript(html);
    expect(() => new vm.Script(script)).not.toThrow();
    const sandbox: { window: Record<string, unknown> } = { window: {} };
    vm.runInNewContext(script, sandbox);
    expect(sandbox.window["__DATA__"]).toMatchObject({ title: "Am7" });
    expect(typeof sandbox.window["__DATA__"]).toBe("object");
  });

  it("escapes </script> inside the data", () => {
    const html = renderDialogHtml({ title: "</script><b>x</b>" });
    expect(() => new vm.Script(firstScript(html))).not.toThrow();
    expect(html.split("</script>").length).toBe(3); // exactly the two real script blocks
  });
});
