import { describe, expect, it } from "vitest";
import { signWebhook, webhookUrlError } from "../src/webhooks";

describe("webhooks", () => {
  it("only sends to public https addresses", () => {
    expect(webhookUrlError("https://hooks.example.com/saralix")).toBeNull();
    expect(webhookUrlError("http://hooks.example.com")).toMatch(/https/);
    expect(webhookUrlError("https://localhost:3000/x")).toMatch(/public address/);
    expect(webhookUrlError("https://10.0.0.5/x")).toMatch(/public address/);
    expect(webhookUrlError("https://192.168.1.4/x")).toMatch(/public address/);
    expect(webhookUrlError("https://169.254.169.254/latest")).toMatch(/public address/);
    expect(webhookUrlError("https://[::1]/x")).toMatch(/public address/);
    expect(webhookUrlError("https://intranet/x")).toMatch(/public address/);
    expect(webhookUrlError("https://user:pw@example.com/x")).toMatch(/user name/);
    expect(webhookUrlError("not a url")).toMatch(/full address/);
    expect(webhookUrlError("http://localhost:4000/x", { allowLocal: true })).toBeNull();
  });
  it("signs the timestamp and body", async () => {
    // HMAC-SHA256("secret", "1700000000.{}")
    expect(await signWebhook("secret", "{}", 1700000000)).toMatch(/^t=1700000000,v1=[0-9a-f]{64}$/);
    expect(await signWebhook("secret", "{}", 1700000000)).toBe(await signWebhook("secret", "{}", 1700000000));
    expect(await signWebhook("secret", "{}", 1700000000)).not.toBe(await signWebhook("other", "{}", 1700000000));
  });
});
