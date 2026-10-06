import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  HostPolicyError,
  assertHostAllowed,
  classifyAddress,
  setHostResolver,
  setLenientHostPolicy,
} from "./host-policy";

describe("classifyAddress", () => {
  it.each([
    ["169.254.169.254", "link_local"],
    ["169.254.0.1", "link_local"],
    ["169.254.255.255", "link_local"],
    ["100.100.100.200", "metadata"],
    ["fe80::1", "link_local"],
    ["FE80::abcd:1", "link_local"],
    ["febf::1", "link_local"],
    ["fd00:ec2::254", "metadata"],
    ["::ffff:169.254.169.254", "link_local"],
    ["::ffff:a9fe:a9fe", "link_local"],
    ["::ffff:100.100.100.200", "metadata"],
    ["64:ff9b::a9fe:a9fe", "link_local"],
    ["127.0.0.1", "loopback"],
    ["127.255.255.254", "loopback"],
    ["0.0.0.0", "loopback"],
    ["::1", "loopback"],
    ["::", "loopback"],
    ["::ffff:127.0.0.1", "loopback"],
    ["::ffff:7f00:1", "loopback"],
    ["192.168.1.20", "ok"],
    ["10.0.0.5", "ok"],
    ["172.16.0.9", "ok"],
    ["169.253.1.1", "ok"],
    ["169.255.1.1", "ok"],
    ["100.100.100.201", "ok"],
    ["fec0::1", "ok"],
    ["fd00::5", "ok"],
    ["2001:db8::1", "ok"],
    ["93.184.216.34", "ok"],
  ])("%s is %s", (ip, expected) => {
    expect(classifyAddress(ip)).toBe(expected);
  });

  it("treats anything that is not an address as ok (the caller resolves names)", () => {
    expect(classifyAddress("docs.example.org")).toBe("ok");
  });
});

describe("assertHostAllowed", () => {
  const answers = new Map<string, string[]>();
  beforeEach(() => {
    answers.clear();
    setLenientHostPolicy(false);
    setHostResolver(async (host) => {
      const found = answers.get(host);
      if (!found) throw new Error("ENOTFOUND");
      return found;
    });
  });
  afterEach(() => {
    setHostResolver(null);
    setLenientHostPolicy(true);
  });

  const reason = async (url: string, allowLoopback = false) => {
    try {
      await assertHostAllowed(url, { allowLoopback });
      return "allowed";
    } catch (err) {
      if (err instanceof HostPolicyError) return err.reason;
      throw err;
    }
  };

  it("allows private and public hosts", async () => {
    answers.set("docs.example.org", ["192.168.1.20"]);
    answers.set("public.example.org", ["93.184.216.34", "2001:db8::1"]);
    expect(await reason("https://docs.example.org")).toBe("allowed");
    expect(await reason("https://public.example.org:8443/x")).toBe("allowed");
    expect(await reason("http://10.1.2.3:8000")).toBe("allowed");
  });

  it("refuses link-local and metadata addresses for everybody", async () => {
    for (const allowLoopback of [false, true]) {
      expect(await reason("http://169.254.169.254/latest", allowLoopback)).toBe(
        "link_local",
      );
      expect(await reason("http://[fe80::1]:8000", allowLoopback)).toBe(
        "link_local",
      );
      expect(await reason("http://100.100.100.200", allowLoopback)).toBe(
        "metadata",
      );
      expect(
        await reason("http://[::ffff:169.254.169.254]", allowLoopback),
      ).toBe("link_local");
    }
  });

  it("refuses the other spellings of the metadata address", async () => {
    for (const url of [
      "http://2852039166",
      "http://0xa9fea9fe",
      "http://0251.0376.0251.0376",
      "http://169.254.43518",
      "http://[::ffff:a9fe:a9fe]",
    ]) {
      expect(await reason(url, true), url).toBe("link_local");
    }
  });

  it("refuses the metadata host name without asking the resolver", async () => {
    for (const url of [
      "http://metadata.google.internal/computeMetadata/v1/",
      "https://METADATA.GOOGLE.INTERNAL./",
    ]) {
      expect(await reason(url, true)).toBe("metadata");
    }
  });

  it("resolves names and refuses one that points at a blocked address", async () => {
    answers.set("evil.example.org", ["169.254.169.254"]);
    answers.set("mixed.example.org", ["93.184.216.34", "169.254.169.254"]);
    answers.set("v6.example.org", ["fe80::1"]);
    expect(await reason("https://evil.example.org")).toBe("link_local");
    expect(await reason("https://mixed.example.org", true)).toBe("link_local");
    expect(await reason("https://v6.example.org", true)).toBe("link_local");
  });

  it("loopback is for administrators and household connections only", async () => {
    answers.set("localhost", ["127.0.0.1", "::1"]);
    answers.set("sneaky.example.org", ["127.0.0.1"]);
    for (const url of [
      "http://127.0.0.1:8000",
      "http://[::1]:8000",
      "http://localhost:8000",
      "http://sneaky.example.org",
      "http://2130706433",
      "http://127.1",
      "http://0.0.0.0:80",
      "http://[::ffff:127.0.0.1]",
    ]) {
      expect(await reason(url, false), url).toBe("loopback");
      expect(await reason(url, true), url).toBe("allowed");
    }
  });

  it("a name that does not resolve is left to the request itself", async () => {
    expect(await reason("https://unknown.example.org")).toBe("allowed");
  });

  it("lenient mode (tests) allows loopback and skips name resolution but still blocks metadata", async () => {
    setHostResolver(null);
    setLenientHostPolicy(true);
    expect(await reason("http://127.0.0.1:1234")).toBe("allowed");
    expect(await reason("http://docs.example.org")).toBe("allowed");
    expect(await reason("http://169.254.169.254")).toBe("link_local");
    expect(await reason("http://metadata.google.internal")).toBe("metadata");
  });
});
