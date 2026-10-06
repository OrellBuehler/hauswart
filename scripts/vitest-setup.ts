import { beforeEach } from "vitest";
import { resetRateLimiters } from "../src/lib/server/auth/rate-limit.ts";
import {
  setHostResolver,
  setLenientHostPolicy,
} from "../src/lib/server/net/host-policy.ts";

beforeEach(() => {
  // The limiters are process-wide; tests must not inherit each other's counters.
  resetRateLimiters();
  // Tests talk to fake servers on 127.0.0.1 and to example.org names: lenient unless a test opts in.
  setLenientHostPolicy(true);
  setHostResolver(null);
});
