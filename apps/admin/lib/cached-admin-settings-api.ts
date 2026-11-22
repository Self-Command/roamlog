import type {
  AdminSettingUpdate,
  AdminSettingsResponse,
  RevealAdminSettingResponse,
  UpdateAdminSettingsResponse,
} from "@roamlog/contracts";

import type { AdminSettingsApi } from "./admin-settings-api";

/**
 * One settings snapshot per console mount.
 *
 * The four system groups are mounted at the same time so switching tabs never
 * discards a draft. Without this wrapper each panel would issue its own
 * identical GET. A successful write invalidates the snapshot; the panel that
 * saved then explicitly re-reads the server before reporting success.
 */
export function createCachedAdminSettingsApi(inner: AdminSettingsApi): AdminSettingsApi {
  let snapshot: AdminSettingsResponse | null = null;
  let pending: Promise<AdminSettingsResponse> | null = null;

  return {
    ...inner,
    list(): Promise<AdminSettingsResponse> {
      if (snapshot) {
        return Promise.resolve(snapshot);
      }
      if (pending) {
        return pending;
      }

      const request = inner
        .list()
        .then((value) => {
          snapshot = value;
          return value;
        })
        .finally(() => {
          pending = null;
        });
      pending = request;
      return request;
    },
    async update(updates: readonly AdminSettingUpdate[]): Promise<UpdateAdminSettingsResponse> {
      const result = await inner.update(updates);
      // UpdateAdminSettingsResponse has no groups payload. Force the caller's
      // post-save list() to read the authoritative server snapshot.
      snapshot = null;
      return result;
    },
    reveal(key: string): Promise<RevealAdminSettingResponse> {
      return inner.reveal(key);
    },
  };
}
