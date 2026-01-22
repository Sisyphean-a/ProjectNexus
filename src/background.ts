// Background service worker
import browser from "webextension-polyfill";

console.log("Nexus background service worker started");

browser.action.onClicked.addListener(() => {
  browser.tabs.create({ url: "index.html" });
});
