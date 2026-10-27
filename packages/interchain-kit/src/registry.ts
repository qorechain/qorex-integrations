// SPDX-License-Identifier: Apache-2.0

import type { Wallet } from "@interchain-kit/core";
import { QOREX_DOWNLOAD_URLS } from "@qorechain/qorex-types";
import { QOREX_ICON_DATA_URI } from "@qorechain/qorex-types/icon";

/** Interchain Kit wallet info for the QoreX extension. */
export const qorexExtensionInfo: Wallet = {
  windowKey: "qorex",
  cosmosKey: "qorex.native",
  walletIdentifyKey: "qorex.native.isQoreX",
  name: "qorex-extension",
  prettyName: "QoreX",
  mode: "extension",
  logo: QOREX_ICON_DATA_URI,
  downloads: [
    { device: "desktop", browser: "chrome", link: QOREX_DOWNLOAD_URLS.chrome },
    { device: "desktop", browser: "firefox", link: QOREX_DOWNLOAD_URLS.firefox },
    { device: "desktop", browser: "safari", link: QOREX_DOWNLOAD_URLS.safari },
    { device: "mobile", os: "ios", link: QOREX_DOWNLOAD_URLS.ios },
    { device: "mobile", os: "android", link: QOREX_DOWNLOAD_URLS.android },
    { link: QOREX_DOWNLOAD_URLS.website },
  ],
};
