import { describe, expect, it } from "vitest";
import { checkPunch, DEFAULT_PUNCH_POLICY, distanceMeters, ipMatches, validIpRule, type Office } from "../src/punch-rules";

const hq: Office = { name: "Bhavnagar HQ", lat: 21.7645, lng: 72.1519, radiusM: 150, allowedIps: ["203.0.113.0/24"] };
const ahd: Office = { name: "Ahmedabad", lat: 23.0225, lng: 72.5714, radiusM: 200, allowedIps: ["2001:db8:10::/48"] };
const policy = { ...DEFAULT_PUNCH_POLICY, location: "block" as const, ip: "flag" as const };

describe("punch rules", () => {
  it("measures distance", () => {
    expect(distanceMeters({ lat: hq.lat!, lng: hq.lng! }, { lat: ahd.lat!, lng: ahd.lng! })).toBeCloseTo(146000, -4); // straight line
    expect(distanceMeters({ lat: hq.lat!, lng: hq.lng! }, { lat: 21.7654, lng: 72.1519 })).toBe(100);
  });

  it("matches IPv4, IPv6 and mapped addresses against ranges", () => {
    expect(ipMatches("203.0.113.77", "203.0.113.0/24")).toBe(true);
    expect(ipMatches("203.0.114.1", "203.0.113.0/24")).toBe(false);
    expect(ipMatches("203.0.113.7", "203.0.113.7")).toBe(true);
    expect(ipMatches("::ffff:203.0.113.9", "203.0.113.0/24")).toBe(true);
    expect(ipMatches("2001:db8:10:5::1", "2001:db8:10::/48")).toBe(true);
    expect(ipMatches("2001:db8:11::1", "2001:db8:10::/48")).toBe(false);
    expect(validIpRule("10.0.0.0/8")).toBe(true);
    expect(validIpRule("10.0.0.0/33")).toBe(false);
    expect(validIpRule("not-an-ip")).toBe(false);
  });

  it("allows a punch at the office, or at another of the company's offices", () => {
    expect(checkPunch(policy, hq, [ahd], { lat: 21.7650, lng: 72.152, ip: "203.0.113.5", wfh: false })).toMatchObject({ allowed: true, flags: [] });
    expect(checkPunch(policy, hq, [ahd], { lat: 23.0226, lng: 72.5715, ip: "2001:db8:10::9", wfh: false })).toMatchObject({ allowed: true, flags: [] });
  });

  it("blocks a punch away from the offices, with the distance", () => {
    const r = checkPunch(policy, hq, [ahd], { lat: 21.80, lng: 72.15, ip: "203.0.113.5", wfh: false });
    expect(r.allowed).toBe(false);
    expect(r.error).toMatch(/You're 4\.0 km from Bhavnagar HQ/);
  });

  it("gives the benefit of GPS accuracy, up to 200 m", () => {
    const near = { lat: 21.7665, lng: 72.1519 }; // about 222 m away
    expect(checkPunch(policy, hq, [], { ...near, accuracyM: 100, ip: "203.0.113.5", wfh: false }).allowed).toBe(true);
    expect(checkPunch(policy, hq, [], { ...near, accuracyM: 10, ip: "203.0.113.5", wfh: false }).allowed).toBe(false);
  });

  it("flags instead of blocking, and asks for location when it's missing", () => {
    const r = checkPunch({ ...policy, location: "flag" }, hq, [], { ip: "198.51.100.1", wfh: false });
    expect(r.allowed).toBe(true);
    expect(r.flags).toEqual(["No location shared", "Not on an office network (198.51.100.1)"]);
    expect(checkPunch(policy, hq, [], { ip: "203.0.113.5", wfh: false }).error).toMatch(/Turn on location/);
  });

  it("leaves work from home alone, and does nothing without offices set up", () => {
    expect(checkPunch(policy, hq, [], { lat: 0, lng: 0, ip: "1.1.1.1", wfh: true }).allowed).toBe(true);
    expect(checkPunch({ ...policy, wfhExempt: false }, hq, [], { lat: 0, lng: 0, ip: "1.1.1.1", wfh: true }).allowed).toBe(false);
    expect(checkPunch(policy, { ...hq, lat: null, lng: null, allowedIps: [] }, [], { wfh: false })).toMatchObject({ allowed: true, flags: [] });
  });
  it("skips the office network check for punches saved offline, but still checks location", () => {
    const blockIp = { ...policy, ip: "block" as const };
    expect(checkPunch(blockIp, hq, [], { lat: 21.765, lng: 72.152, ip: "198.51.100.1", wfh: false }).allowed).toBe(false);
    expect(checkPunch(blockIp, hq, [], { lat: 21.765, lng: 72.152, ip: "198.51.100.1", wfh: false, offline: true })).toMatchObject({ allowed: true, flags: [] });
    expect(checkPunch(blockIp, hq, [], { lat: 21.8, lng: 72.15, ip: null, wfh: false, offline: true }).allowed).toBe(false);
  });
});
