import { afterAll, afterEach, beforeEach } from "vitest";
import { getDB } from "$lib/server/db";
import { saveConnection } from "$lib/server/connections/connections";
import { settleBackgroundWork } from "$lib/server/attachments/attachments";
import { registerPaperlessAdapter } from "./index";
import { startFakePaperless, type FakePaperless } from "./fake-server";
import { uploadPolling } from "./provider";

/**
 * Test harness: one fake Paperless per test file, reset before every test, the adapter and
 * document provider registered for the test. `connect(userId)` stores that person's connection
 * pointing at the fake (the way the settings API does, token encrypted); call it inside a test,
 * after `useTestDB()` has opened the database. Pushes are polled quickly.
 */
export function useFakePaperless(): {
  readonly fake: FakePaperless;
  connect(
    userId: string,
    over?: {
      token?: string;
      config?: Record<string, unknown>;
      enabled?: boolean;
    },
  ): ReturnType<typeof saveConnection>;
} {
  const fake = startFakePaperless();
  let off: (() => void) | null = null;
  const previous = { ...uploadPolling };
  afterAll(() => fake.stop());
  beforeEach(() => {
    fake.reset();
    off = registerPaperlessAdapter();
    uploadPolling.pollMs = 1;
    uploadPolling.timeoutMs = 2_000;
  });
  afterEach(async () => {
    await settleBackgroundWork();
    off?.();
    off = null;
    Object.assign(uploadPolling, previous);
  });
  return {
    fake,
    connect: (userId, over = {}) =>
      saveConnection({ db: getDB(), now: Date.now() }, "paperless", userId, {
        baseUrl: fake.baseUrl,
        token: over.token ?? fake.token,
        allowInsecureTls: false,
        config: over.config,
        enabled: over.enabled,
      }),
  };
}

/** What the tests of the document API share: two people with their own accounts, a fake with some taxonomy. */
export const TEST_CONFIG = {
  sharedTagIds: [1],
  receiptTagIds: [2],
  manualTagIds: [3],
  warrantyFieldId: 7,
  warrantyExtendedFieldId: 8,
  uploadTagIds: [5],
  uploadStoragePathId: 3,
  uploadCorrespondentId: 20,
  shareGroupIds: [50],
};

export function seedTaxonomy(fake: FakePaperless): void {
  fake.tags = [
    { id: 1, name: "Apartment" },
    { id: 2, name: "Receipt" },
    { id: 3, name: "Manual" },
    { id: 4, name: "Private" },
    { id: 5, name: "From hauswart" },
  ];
  fake.correspondents = [
    { id: 20, name: "Example Shop" },
    { id: 21, name: "Acme Heating" },
  ];
  fake.customFields = [
    { id: 7, name: "Warranty until", data_type: "date" },
    { id: 8, name: "Warranty extended", data_type: "date" },
  ];
  fake.groups = [{ id: 50, name: "Household" }];
  fake.storagePaths = [{ id: 3, name: "Apartment", path: "apartment/{title}" }];
}
