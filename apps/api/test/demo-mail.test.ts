import { describe, expect, it } from "vitest";
import { SkipDemoMailer, type EmailMessage, type Mailer } from "../src/lib/email";

describe("demo account email", () => {
  it("never sends to the reserved demo domain", async () => {
    const sent: string[] = [];
    const inner: Mailer = { send: async (m: EmailMessage) => void sent.push(m.to) };
    const mailer = new SkipDemoMailer(inner);
    const msg = { subject: "Hi", html: "<p>Hi</p>", text: "Hi" };
    await mailer.send({ ...msg, to: "hardik.mehta@demo.saralix.com" });
    await mailer.send({ ...msg, to: "Someone@DEMO.saralix.com" });
    await mailer.send({ ...msg, to: "real.person@example.com" });
    expect(sent).toEqual(["real.person@example.com"]);
  });
});
