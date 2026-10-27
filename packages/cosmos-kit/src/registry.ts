// SPDX-License-Identifier: Apache-2.0

import type { Wallet } from "@cosmos-kit/core";
import { QOREX_DOWNLOAD_URLS } from "@qorechain/qorex-types";
import { QOREX_ICON_DATA_URI } from "@qorechain/qorex-types/icon";

/** cosmos-kit wallet info for the QoreX extension. */
export const qorexExtensionInfo: Wallet = {
  name: "qorex-extension",
  prettyName: "QoreX",
  logo: QOREX_ICON_DATA_URI,
  mode: "extension",
  // On mobile, QoreX is available only inside the QoreX app's browser, which injects window.qorex.
  mobileDisabled: () =>
    !(typeof window !== "undefined" && typeof (window as { qorex?: { native?: unknown } }).qorex?.native === "object"),
  rejectMessage: {
    source: "QoreX: connection rejected",
  },
  downloads: [
    { device: "desktop", browser: "chrome", link: QOREX_DOWNLOAD_URLS.chrome },
    { device: "desktop", browser: "firefox", link: QOREX_DOWNLOAD_URLS.firefox },
    { device: "desktop", browser: "safari", link: QOREX_DOWNLOAD_URLS.safari },
    { device: "mobile", os: "ios", link: QOREX_DOWNLOAD_URLS.ios },
    { device: "mobile", os: "android", link: QOREX_DOWNLOAD_URLS.android },
    { link: QOREX_DOWNLOAD_URLS.website },
  ],
};
