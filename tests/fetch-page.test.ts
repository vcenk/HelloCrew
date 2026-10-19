import { vi } from "vitest";
vi.mock("server-only", () => ({}));
import http from "node:http";
import { describe, expect, it } from "vitest";

import {
  checkPublicUrl,
  fetchPublicPage,
  htmlToText,
  isPrivateAddress,
  PageFetchError,
} from "../lib/server/fetch-page";

describe("reading website links safely", () => {
  it("knows which addresses are internal", () => {
    for (const ip of ["127.0.0.1", "10.1.2.3", "172.20.0.1", "192.168.1.1", "169.254.169.254", "100.64.0.1", "0.0.0.0", "::1", "fd00::1", "fe80::1", "::ffff:127.0.0.1"])
      expect(isPrivateAddress(ip), ip).toBe(true);
    for (const ip of ["8.8.8.8", "104.16.0.1", "2606:4700::1111"]) expect(isPrivateAddress(ip), ip).toBe(false);
  });

  it("accepts public web addresses only", () => {
    expect(checkPublicUrl("mysalon.com/prices#top").toString()).toBe("https://mysalon.com/prices");
    for (const bad of ["http://localhost:3000", "http://127.0.0.1/", "http://169.254.169.254/latest", "http://[::1]/", "ftp://x.com", "https://user:pw@x.com", "https://x.com:8080/", "http://intranet/", "https://printer.local/"])
      expect(() => checkPublicUrl(bad), bad).toThrow(PageFetchError);
  });

  it("refuses to fetch from this machine", async () => {
    const server = http.createServer((_, res) => res.end("<p>secret internal page</p>"));
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    const port = (server.address() as { port: number }).port;
    await expect(fetchPublicPage(`http://127.0.0.1:${port}/`)).rejects.toBeInstanceOf(PageFetchError);
    server.close();
  });

  it("keeps the readable text of a page", () => {
    const { title, text } = htmlToText(`<!doctype html><html><head><title>Prices &amp; Services</title>
      <style>.x{}</style><script>alert(1)</script></head><body>
      <nav><a>Home</a><a>About</a></nav>
      <h1>Our prices</h1><table><tr><td>Haircut</td><td>$60</td></tr><tr><td>Colour</td><td>$95</td></tr></table>
      <ul><li>Free parking</li><li>Wi&#8209;Fi</li></ul><footer>© 2026</footer></body></html>`);
    expect(title).toBe("Prices & Services");
    expect(text).toContain("## Our prices");
    expect(text).toContain("Haircut | $60");
    expect(text).toContain("- Free parking");
    expect(text).not.toMatch(/alert|Home|About|© 2026/);
  });

  it("prefers the main content when the page has it", () => {
    const filler = "Real content about our services and prices. ".repeat(10);
    const { text } = htmlToText(`<body><div>Cookie banner text</div><main><p>${filler}</p></main></body>`);
    expect(text).not.toContain("Cookie banner");
    expect(text).toContain("Real content");
  });
});
