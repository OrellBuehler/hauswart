import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  HostPolicyError,
  HostUnresolvedError,
  assertHostAllowed,
  assertPublicUrl,
  classifyAddress,
  classifyPublicAddress,
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

describe("classifyPublicAddress", () => {
  it.each([
    // IPv4: loopback, unspecified
    ["127.0.0.1", "loopback"],
    ["127.255.255.254", "loopback"],
    ["0.0.0.0", "unspecified"],
    ["0.1.2.3", "unspecified"],
    // IPv4: private networks, with both edges of each range
    ["10.0.0.1", "private"],
    ["10.255.255.255", "private"],
    ["172.16.0.1", "private"],
    ["172.31.255.255", "private"],
    ["172.15.255.255", "ok"],
    ["172.32.0.0", "ok"],
    ["192.168.0.1", "private"],
    ["192.168.255.255", "private"],
    ["192.167.255.255", "ok"],
    ["192.169.0.0", "ok"],
    // IPv4: carrier-grade NAT, with the metadata address inside it
    ["100.64.0.1", "cgnat"],
    ["100.127.255.255", "cgnat"],
    ["100.63.255.255", "ok"],
    ["100.128.0.0", "ok"],
    ["100.100.100.200", "metadata"],
    // IPv4: link-local, multicast, reserved
    ["169.254.169.254", "link_local"],
    ["169.254.0.1", "link_local"],
    ["169.253.255.255", "ok"],
    ["224.0.0.1", "multicast"],
    ["239.255.255.255", "multicast"],
    ["223.255.255.255", "ok"],
    ["240.0.0.1", "reserved"],
    ["255.255.255.255", "reserved"],
    ["192.0.0.1", "reserved"],
    ["192.0.2.1", "reserved"],
    ["198.51.100.7", "reserved"],
    ["203.0.113.9", "reserved"],
    ["198.18.0.1", "reserved"],
    ["198.19.255.255", "reserved"],
    ["198.20.0.1", "ok"],
    // IPv4: public
    ["8.8.8.8", "ok"],
    ["1.1.1.1", "ok"],
    ["93.184.216.34", "ok"],
    // IPv6: loopback, unspecified, link-local, unique local, multicast
    ["::1", "loopback"],
    ["::", "unspecified"],
    ["fe80::1", "link_local"],
    ["febf::1", "link_local"],
    ["fc00::1", "unique_local"],
    ["fd12:3456:789a::1", "unique_local"],
    ["fd00:ec2::254", "metadata"],
    ["fec0::1", "private"],
    ["ff02::1", "multicast"],
    ["ff00::", "multicast"],
    // IPv6: IPv4-mapped, judged by the IPv4 address they carry
    ["::ffff:10.0.0.1", "private"],
    ["::ffff:7f00:1", "loopback"],
    ["::ffff:127.0.0.1", "loopback"],
    ["::ffff:169.254.169.254", "link_local"],
    ["::ffff:100.100.100.200", "metadata"],
    ["::ffff:c0a8:1", "private"],
    ["::ffff:0.0.0.0", "unspecified"],
    ["::ffff:192.0.2.1", "reserved"],
    ["::ffff:8.8.8.8", "ok"],
    // IPv6: the deprecated IPv4-compatible form
    ["::10.0.0.1", "private"],
    ["::7f00:1", "loopback"],
    ["::808:808", "ok"],
    // IPv6: NAT64 (well-known prefix carries an IPv4 address, the local-use prefix is private)
    ["64:ff9b::a00:1", "private"],
    ["64:ff9b::10.0.0.1", "private"],
    ["64:ff9b::7f00:1", "loopback"],
    ["64:ff9b::a9fe:a9fe", "link_local"],
    ["64:ff9b::6464:64c8", "metadata"],
    ["64:ff9b::808:808", "ok"],
    ["64:ff9b:1::1", "private"],
    // IPv6: 6to4 carries an IPv4 address in the 32 bits after the prefix
    ["2002:a00:1::", "private"],
    ["2002:7f00:1::1", "loopback"],
    ["2002:808:808::1", "ok"],
    // IPv6: reserved ranges inside and outside global unicast
    ["2001:db8::1", "reserved"],
    ["2001::1", "reserved"],
    ["3fff::1", "reserved"],
    ["100::1", "reserved"],
    ["4000::1", "reserved"],
    ["8000::1", "reserved"],
    // IPv6: public
    ["2606:4700:4700::1111", "ok"],
    ["2001:4860:4860::8888", "ok"],
    ["2a00:1450:4001:81b::200e", "ok"],
    // spelling does not matter
    ["FE80::ABCD:1", "link_local"],
    ["[::1]", "loopback"],
    ["fe80::1%eth0", "link_local"],
  ])("%s is %s", (ip, expected) => {
    expect(classifyPublicAddress(ip)).toBe(expected);
  });

  it("treats anything that is not an address as ok (the caller resolves names)", () => {
    expect(classifyPublicAddress("docs.example.org")).toBe("ok");
  });
});

describe("assertPublicUrl", () => {
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

  const outcome = async (url: string) => {
    try {
      await assertPublicUrl(url);
      return "allowed";
    } catch (err) {
      if (err instanceof HostPolicyError) return err.reason;
      if (err instanceof HostUnresolvedError) return "unresolved";
      throw err;
    }
  };

  it("allows public addresses and names that resolve to public addresses only", async () => {
    answers.set("docs.example.org", ["93.184.216.34", "2606:4700:4700::1111"]);
    expect(await outcome("https://docs.example.org/manual.pdf")).toBe(
      "allowed",
    );
    expect(await outcome("http://docs.example.org:80/x")).toBe("allowed");
    expect(await outcome("https://docs.example.org:443/x")).toBe("allowed");
    expect(await outcome("http://8.8.8.8/x.png")).toBe("allowed");
    expect(await outcome("https://[2606:4700:4700::1111]/x")).toBe("allowed");
  });

  it.each([
    ["ftp://docs.example.org/a.pdf", "scheme"],
    ["file:///etc/passwd", "scheme"],
    ["gopher://docs.example.org/", "scheme"],
    ["javascript:alert(1)", "scheme"],
    ["https://user@docs.example.org/", "credentials"],
    ["https://user:pw@docs.example.org/", "credentials"],
    ["http://docs.example.org:8080/", "port"],
    ["https://docs.example.org:8443/", "port"],
    ["https://docs.example.org:80/", "port"],
    ["http://docs.example.org:443/", "port"],
  ])("refuses %s (%s)", async (url, reason) => {
    answers.set("docs.example.org", ["93.184.216.34"]);
    expect(await outcome(url)).toBe(reason);
  });

  it.each([
    ["http://127.0.0.1/", "loopback"],
    ["http://[::1]/", "loopback"],
    ["http://10.1.2.3/", "private"],
    ["http://192.168.1.20/manual.pdf", "private"],
    ["http://172.16.5.5/", "private"],
    ["http://100.64.0.9/", "cgnat"],
    ["http://169.254.169.254/latest/meta-data", "link_local"],
    ["http://100.100.100.200/", "metadata"],
    ["http://[fd00:ec2::254]/", "metadata"],
    ["http://[fc00::1]/", "unique_local"],
    ["http://[fe80::1]/", "link_local"],
    ["http://224.0.0.1/", "multicast"],
    ["http://[ff02::1]/", "multicast"],
    ["http://0.0.0.0/", "unspecified"],
    ["http://[::]/", "unspecified"],
    ["http://[::ffff:10.0.0.1]/", "private"],
    ["http://[::ffff:127.0.0.1]/", "loopback"],
    ["http://[64:ff9b::a00:1]/", "private"],
    ["http://[64:ff9b::7f00:1]/", "loopback"],
    ["http://203.0.113.5/", "reserved"],
    ["http://[2001:db8::1]/", "reserved"],
    // other spellings of the same addresses
    ["http://2130706433/", "loopback"],
    ["http://0x7f000001/", "loopback"],
    ["http://127.1/", "loopback"],
    ["http://0177.0.0.1/", "loopback"],
    ["http://2852039166/", "link_local"],
    ["http://0xa9fea9fe/", "link_local"],
    ["http://3232235777/", "private"],
    ["http://metadata.google.internal/computeMetadata/v1/", "metadata"],
    ["https://METADATA.GOOGLE.INTERNAL./", "metadata"],
  ])("refuses the address literal %s (%s)", async (url, reason) => {
    expect(await outcome(url)).toBe(reason);
  });

  it("resolves a name and refuses it when any address it answers with is not public", async () => {
    answers.set("lan.example.org", ["192.168.1.20"]);
    answers.set("mixed.example.org", ["93.184.216.34", "10.0.0.5"]);
    answers.set("loop.example.org", ["127.0.0.1"]);
    answers.set("localhost", ["127.0.0.1", "::1"]);
    answers.set("v6.example.org", ["2606:4700:4700::1111", "fd12::1"]);
    answers.set("mapped.example.org", ["::ffff:169.254.169.254"]);
    answers.set("nat64.example.org", ["64:ff9b::a00:1"]);
    expect(await outcome("https://lan.example.org")).toBe("private");
    expect(await outcome("https://mixed.example.org")).toBe("private");
    expect(await outcome("https://loop.example.org")).toBe("loopback");
    expect(await outcome("http://localhost/")).toBe("loopback");
    expect(await outcome("https://v6.example.org")).toBe("unique_local");
    expect(await outcome("https://mapped.example.org")).toBe("link_local");
    expect(await outcome("https://nat64.example.org")).toBe("private");
  });

  it("a name that does not resolve, or resolves to nothing, is unresolved: the request could not be made either", async () => {
    answers.set("empty.example.org", []);
    expect(await outcome("https://unknown.example.org")).toBe("unresolved");
    expect(await outcome("https://empty.example.org")).toBe("unresolved");
  });

  it("the metadata host name is refused without asking the resolver", async () => {
    setHostResolver(async () => {
      throw new Error("must not be asked");
    });
    expect(await outcome("http://metadata.google.internal/")).toBe("metadata");
  });

  it("lenient mode (tests) lets loopback and any port through and does not resolve names, but nothing else", async () => {
    setHostResolver(null);
    setLenientHostPolicy(true);
    expect(await outcome("http://127.0.0.1:41234/x")).toBe("allowed");
    expect(await outcome("http://[::1]:8080/x")).toBe("allowed");
    expect(await outcome("http://docs.example.org:8080/x")).toBe("allowed");
    expect(await outcome("http://10.0.0.1:8080/x")).toBe("private");
    expect(await outcome("http://169.254.169.254/")).toBe("link_local");
    expect(await outcome("http://metadata.google.internal/")).toBe("metadata");
    expect(await outcome("ftp://127.0.0.1/")).toBe("scheme");
    expect(await outcome("http://user:pw@127.0.0.1/")).toBe("credentials");
  });
});
