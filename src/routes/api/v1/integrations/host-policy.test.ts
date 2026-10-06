import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { connections } from "$lib/server/db";
import { saveConnection } from "$lib/server/connections/connections";
import { updateHousehold } from "$lib/server/household/household";
import {
  registerIntegration,
  type ConnectionTestResult,
} from "$lib/server/connections/registry";
import {
  HostPolicyError,
  assertHostAllowed,
  setHostResolver,
  setLenientHostPolicy,
} from "$lib/server/net/host-policy";
import { createCaller, errorCode } from "$lib/testing/api";
import { createTestUser, loginTestUser, setUserRole } from "$lib/testing/auth";
import { useTestDB } from "$lib/testing/db";

const TOKEN = "a-test-token-value";

describe("who may point a connection where", () => {
  const test = useTestDB();
  const dns = new Map<string, string[]>();
  const stops: (() => void)[] = [];

  beforeEach(() => {
    dns.clear();
    setLenientHostPolicy(false);
    setHostResolver(async (host) => {
      const found = dns.get(host);
      if (!found) throw new Error("ENOTFOUND");
      return found;
    });
  });
  afterEach(() => {
    stops.splice(0).forEach((stop) => stop());
    setHostResolver(null);
    setLenientHostPolicy(true);
  });

  const allow = (...hosts: string[]) =>
    updateHousehold(
      { db: test.db },
      { settings: { integrationHostAllowlist: hosts } },
    );

  async function people() {
    const admin = await createTestUser({ role: "admin" });
    const member = await createTestUser();
    const as = (u: typeof admin) =>
      createCaller({ session: loginTestUser(u).token });
    return { admin, member, asAdmin: as(admin), asMember: as(member) };
  }

  const put = (
    call: ReturnType<typeof createCaller>,
    kind: string,
    baseUrl: string,
  ) =>
    call("PUT", `/api/v1/integrations/${kind}`, {
      json: { baseUrl, token: TOKEN, allowInsecureTls: false },
    });
  const outcome = (r: Awaited<ReturnType<typeof put>>) => [
    r.res.status,
    errorCode(r),
  ];
  const message = (r: Awaited<ReturnType<typeof put>>) =>
    (r.body as { error: { message: string } }).error.message;

  describe("members and the allow-list", () => {
    it("are refused any host while the list is empty, and nothing is stored", async () => {
      const { asMember } = await people();
      const r = await put(asMember, "paperless", "https://docs.example.org");
      expect(outcome(r)).toEqual([403, "forbidden"]);
      expect(message(r)).toMatch(/allow/i);
      expect(message(r)).toMatch(/administrator/i);
      expect(test.db.select().from(connections).all()).toEqual([]);
    });

    it("may save a host on the list, whatever the case, path or scheme", async () => {
      const { asMember } = await people();
      allow("docs.example.org", "Kept.Example.ORG");
      for (const [kind, url] of [
        ["paperless", "https://DOCS.example.org/paperless/"],
        ["kept", "http://kept.example.org:8080"],
      ] as const) {
        expect((await put(asMember, kind, url)).res.status, url).toBe(200);
      }
    });

    it("compare internationalised names in their ascii form", async () => {
      const { asMember } = await people();
      allow("bücher.example.org");
      expect(
        (await put(asMember, "paperless", "https://BÜCHER.example.org")).res
          .status,
      ).toBe(200);
      expect(
        (await put(asMember, "paperless", "https://xn--bcher-kva.example.org"))
          .res.status,
      ).toBe(200);
    });

    it("are refused look-alikes, sub-domains, parents and other ports", async () => {
      const { asMember } = await people();
      allow("docs.example.org", "kept.example.org:8443");
      for (const [kind, url] of [
        ["paperless", "https://a.docs.example.org"],
        ["paperless", "https://example.org"],
        ["paperless", "https://docs.example.org.evil.test"],
        ["paperless", "https://docs.example.org@evil.test"],
        ["kept", "https://kept.example.org"],
        ["kept", "https://kept.example.org:9000"],
      ] as const) {
        const r = await put(asMember, kind, url);
        expect([url, ...outcome(r)], url).toEqual([url, 403, "forbidden"]);
      }
      expect(
        (await put(asMember, "kept", "https://kept.example.org:8443")).res
          .status,
      ).toBe(200);
    });

    it("an address that is no address stays a field error", async () => {
      const { asMember } = await people();
      allow("docs.example.org");
      const r = await put(asMember, "paperless", "not a url");
      expect(outcome(r)).toEqual([400, "invalid_request"]);
    });

    it("lose the right when the host leaves the list: saving again is refused", async () => {
      const { asMember } = await people();
      allow("docs.example.org");
      expect(
        (await put(asMember, "paperless", "https://docs.example.org")).res
          .status,
      ).toBe(200);
      allow();
      const r = await put(asMember, "paperless", "https://docs.example.org");
      expect(outcome(r)).toEqual([403, "forbidden"]);
    });
  });

  describe("administrators", () => {
    it("may save any host, and saving adds nothing to the list", async () => {
      const { asAdmin } = await people();
      for (const [kind, url] of [
        ["paperless", "https://docs.example.org"],
        ["kept", "http://192.168.1.20:8080"],
        ["homeassistant", "http://home.example.org:8123"],
      ] as const) {
        expect((await put(asAdmin, kind, url)).res.status, url).toBe(200);
      }
      const household = (await asAdmin("GET", "/api/v1/household")).body as {
        settings: { integrationHostAllowlist: string[] };
      };
      expect(household.settings.integrationHostAllowlist).toEqual([]);
    });
  });

  describe("link-local and metadata addresses", () => {
    const blocked = [
      "http://169.254.169.254/latest/meta-data",
      "http://169.254.0.1",
      "http://[fe80::1]:8000",
      "http://[::ffff:169.254.169.254]",
      "http://2852039166",
      "http://100.100.100.200",
      "http://metadata.google.internal",
      "https://METADATA.GOOGLE.INTERNAL.",
    ];

    it("are refused for administrators and household connections too", async () => {
      const { asAdmin } = await people();
      for (const url of blocked) {
        for (const kind of ["paperless", "kept", "homeassistant"]) {
          const r = await put(asAdmin, kind, url);
          expect([url, kind, ...outcome(r)]).toEqual([
            url,
            kind,
            400,
            "invalid_request",
          ]);
          expect(JSON.stringify(r.body)).toMatch(/baseUrl/);
        }
      }
      expect(test.db.select().from(connections).all()).toEqual([]);
    });

    it("are refused for members even when an administrator listed them", async () => {
      const { asMember } = await people();
      allow(
        "169.254.169.254",
        "metadata.google.internal",
        "[fe80::1]",
        "100.100.100.200",
      );
      for (const url of [
        "http://169.254.169.254",
        "http://metadata.google.internal",
        "http://[fe80::1]",
        "http://100.100.100.200",
      ]) {
        const r = await put(asMember, "paperless", url);
        expect([url, ...outcome(r)], url).toEqual([
          url,
          400,
          "invalid_request",
        ]);
      }
    });

    it("are refused when the name resolves to one", async () => {
      const { asAdmin, asMember } = await people();
      dns.set("evil.example.org", ["93.184.216.34", "169.254.169.254"]);
      dns.set("six.example.org", ["fe80::1"]);
      allow("evil.example.org", "six.example.org");
      for (const call of [asAdmin, asMember]) {
        for (const host of ["evil.example.org", "six.example.org"]) {
          const r = await put(call, "paperless", `https://${host}`);
          expect([host, ...outcome(r)]).toEqual([host, 400, "invalid_request"]);
        }
      }
    });

    it("a name that resolves to a private address is fine", async () => {
      const { asMember } = await people();
      dns.set("docs.example.org", ["192.168.1.20"]);
      allow("docs.example.org");
      expect(
        (await put(asMember, "paperless", "https://docs.example.org")).res
          .status,
      ).toBe(200);
    });
  });

  describe("loopback", () => {
    it("is for administrators and household connections", async () => {
      const { asAdmin } = await people();
      dns.set("localhost", ["127.0.0.1", "::1"]);
      for (const [kind, url] of [
        ["paperless", "http://127.0.0.1:8000"],
        ["kept", "http://localhost:8080"],
        ["homeassistant", "http://[::1]:8123"],
      ] as const) {
        expect((await put(asAdmin, kind, url)).res.status, url).toBe(200);
      }
    });

    it("is refused to members even on the allow-list", async () => {
      const { asMember } = await people();
      dns.set("localhost", ["127.0.0.1"]);
      dns.set("sneaky.example.org", ["127.0.0.2"]);
      allow("127.0.0.1", "localhost", "sneaky.example.org", "[::1]", "0.0.0.0");
      for (const url of [
        "http://127.0.0.1:8000",
        "http://localhost:8000",
        "http://sneaky.example.org",
        "http://[::1]:8000",
        "http://0.0.0.0:8000",
      ]) {
        const r = await put(asMember, "paperless", url);
        expect([url, ...outcome(r)], url).toEqual([url, 403, "forbidden"]);
        expect(message(r)).toMatch(/administrator/i);
      }
    });
  });

  describe("on every request", () => {
    function probe(kind: "paperless" | "kept") {
      stops.push(
        registerIntegration({
          kind,
          describe: () => ({ capabilities: [] }),
          test: async (connection): Promise<ConnectionTestResult> => {
            try {
              await assertHostAllowed(connection.baseUrl, {
                allowLoopback: connection.allowLoopback,
              });
              return { ok: true };
            } catch (err) {
              return {
                ok: false,
                error: {
                  code: err instanceof HostPolicyError ? "blocked_host" : "x",
                  message: "x",
                },
              };
            }
          },
        }),
      );
    }
    const store = (userId: string, baseUrl: string, kind = "paperless") =>
      saveConnection(
        { db: test.db, now: Date.now() },
        kind as "paperless",
        userId,
        {
          baseUrl,
          token: TOKEN,
          allowInsecureTls: false,
        },
      );
    const testIt = async (call: ReturnType<typeof createCaller>) =>
      (
        (await call("POST", "/api/v1/integrations/paperless/test")).body as {
          ok: boolean;
          error: { code: string } | null;
        }
      ).error?.code ?? "ok";

    it("a member's connection to loopback is blocked, an administrator's is not", async () => {
      probe("paperless");
      const { admin, member, asAdmin, asMember } = await people();
      store(admin.id, "http://127.0.0.1:8000");
      store(member.id, "http://127.0.0.1:8000");
      expect(await testIt(asAdmin)).toBe("ok");
      expect(await testIt(asMember)).toBe("blocked_host");
    });

    it("a demotion takes the loopback right away at once", async () => {
      probe("paperless");
      const { admin, asAdmin } = await people();
      store(admin.id, "http://127.0.0.1:8000");
      expect(await testIt(asAdmin)).toBe("ok");
      setUserRole(admin.id, "member");
      expect(await testIt(asAdmin)).toBe("blocked_host");
    });

    it("a name that was fine when saved but now resolves to a metadata address is blocked", async () => {
      probe("paperless");
      const { asAdmin } = await people();
      dns.set("docs.example.org", ["192.168.1.20"]);
      expect(
        (await put(asAdmin, "paperless", "https://docs.example.org")).res
          .status,
      ).toBe(200);
      expect(await testIt(asAdmin)).toBe("ok");
      dns.set("docs.example.org", ["169.254.169.254"]);
      expect(await testIt(asAdmin)).toBe("blocked_host");
    });
  });
});
