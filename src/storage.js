// Browser-storage shim.
//
// The original app ran as a Claude.ai Artifact and used the Claude-only
// `window.storage` API (async, returns { value }). As a standalone website we
// back the same shape with the browser's own localStorage, so the rest of the
// app code is unchanged. Data stays on the attorney's own device/browser.
export const storage = {
  async get(key) {
    try {
      const v = localStorage.getItem(key);
      return v === null ? null : { value: v };
    } catch (e) {
      return null;
    }
  },
  async set(key, value) {
    try {
      localStorage.setItem(key, value);
    } catch (e) {
      /* ignore quota / private-mode errors */
    }
  },
  async delete(key) {
    try {
      localStorage.removeItem(key);
    } catch (e) {
      /* ignore */
    }
  },
};
