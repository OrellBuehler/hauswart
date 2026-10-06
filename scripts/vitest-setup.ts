import { beforeEach } from "vitest";
import { resetRateLimiters } from "../src/lib/server/auth/rate-limit.ts";

// The limiters are process-wide; tests must not inherit each other's counters.
beforeEach(() => resetRateLimiters());
