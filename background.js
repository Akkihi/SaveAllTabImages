const DEFAULT_FOLDER = "AllTabsImages";
const STORAGE_KEY = "targetFolder";

const PROMPTS = {
  folder: "Folder inside downloads (will be created if missing)",
  newFolder: "New folder inside downloads",
};

function isAllowedUrl(url) {
  if (!url) return false;
  try {
    const { protocol } = new URL(url);
    return protocol === "http:" || protocol === "https:" || protocol === "file:";
  } catch {
    return false;
  }
}

async function queryWindowTabs() {
  const tabs = await chrome.tabs.query({ currentWindow: true });
  return tabs.filter((t) => isAllowedUrl(t.url));
}

async function resolvePromptTab(fallbackTabId) {
  const tabs = await queryWindowTabs();
  return tabs[0]?.id ?? fallbackTabId ?? null;
}

async function askFolder(message, fallback, tabId) {
  const targetTabId = await resolvePromptTab(tabId);
  if (!targetTabId) return fallback;
  const [promptResult] = await chrome.scripting.executeScript({
    target: { tabId: targetTabId },
    func: (message, fallback) => {
      const value = prompt(message, fallback);
      return value ? value.trim() : "";
    },
    args: [message, fallback],
  });
  return promptResult?.result || fallback;
}

async function getFolder(tabId) {
  const res = await chrome.storage.local.get(STORAGE_KEY);
  if (res[STORAGE_KEY]) return res[STORAGE_KEY];
  const folder = await askFolder(PROMPTS.folder, DEFAULT_FOLDER, tabId);
  await chrome.storage.local.set({ [STORAGE_KEY]: folder });
  return folder;
}

async function setFolder(tabId) {
  const current = (await chrome.storage.local.get(STORAGE_KEY))[STORAGE_KEY] || DEFAULT_FOLDER;
  const folder = await askFolder(PROMPTS.newFolder, current, tabId);
  if (!folder) return null;
  await chrome.storage.local.set({ [STORAGE_KEY]: folder });
  return folder;
}

async function collectImages(tabId, url) {
  if (!isAllowedUrl(url)) return [];
  const [result] = await chrome.scripting.executeScript({
    target: { tabId },
    func: () => {
      const urls = [];
      const pushUrl = (u, area = 0) => {
        if (!u) return;
        try {
          const href = new URL(u, location.href).href;
          urls.push({ url: href, area });
        } catch (_) {}
      };

      document.querySelectorAll("img[src]").forEach((img) => {
        const area = (img.naturalWidth || img.width || 0) * (img.naturalHeight || img.height || 0);
        pushUrl(img.src, area);
      });

      document.querySelectorAll("source[srcset],img[srcset]").forEach((el) => {
        const set = el.getAttribute("srcset");
        if (!set) return;
        let best = null;
        set.split(",").forEach((part) => {
          const pieces = part.trim().split(/\s+/);
          if (!pieces[0]) return;
          const candUrl = pieces[0];
          const desc = pieces[1] || "";
          let score = 0;
          if (desc.endsWith("w")) score = parseInt(desc, 10) || 0;
          if (desc.endsWith("x")) score = Math.round(parseFloat(desc) * 1000) || 0;
          if (!best || score > best.score) best = { candUrl, score };
        });
        if (best) pushUrl(best.candUrl, best.score);
      });

      document.querySelectorAll("*").forEach((el) => {
        const bg = getComputedStyle(el).backgroundImage;
        if (!bg || bg === "none") return;
        bg.split(",").forEach((entry) => {
          const m = entry.trim().match(/^url\(["']?(.*?)["']?\)$/i);
          if (m && m[1]) pushUrl(m[1], 0);
        });
      });

      const seen = new Map();
      urls.forEach(({ url, area }) => {
        if (!seen.has(url) || area > seen.get(url)) seen.set(url, area);
      });
      return Array.from(seen.entries()).map(([url, area]) => ({ url, area }));
    },
  });
  return result?.result || [];
}

function makeFilename(folder, url, index) {
  try {
    const u = new URL(url);
    const parts = u.pathname.split("/").filter(Boolean);
    let name = parts.pop() || `image-${index}`;
    if (!name.includes(".")) name += ".png";
    return `${folder}/${name}`;
  } catch {
    return `${folder}/image-${index}.png`;
  }
}

async function downloadWithName(url, filename) {
  const id = await chrome.downloads.download({
    url,
    filename,
    conflictAction: "uniquify",
  });
  return id;
}

async function downloadAll() {
  const tabs = await queryWindowTabs();
  if (!tabs.length) return;
  const seen = new Set();
  let counter = 1;
  const folder = await getFolder(tabs[0]?.id);
  let firstDownloadId = null;

  for (const tab of tabs) {
    let imgs = [];
    try {
      imgs = await collectImages(tab.id, tab.url);
    } catch (e) {
      console.warn("skip tab", tab.url, e);
      continue;
    }
    for (const item of imgs) {
      if (seen.has(item.url)) continue;
      seen.add(item.url);
      try {
        const id = await downloadWithName(item.url, makeFilename(folder, item.url, counter++));
        if (firstDownloadId === null) firstDownloadId = id;
      } catch (e) {
        console.error(e);
      }
    }
  }
  if (firstDownloadId !== null) {
    try {
      chrome.downloads.show(firstDownloadId);
    } catch (e) {
      console.warn("show download", e);
    }
  }
}

async function downloadLargestPerTab() {
  const tabs = await queryWindowTabs();
  if (!tabs.length) return;
  const folder = await getFolder(tabs[0]?.id);
  let counter = 1;
  let firstDownloadId = null;

  for (const tab of tabs) {
    let imgs = [];
    try {
      imgs = await collectImages(tab.id, tab.url);
    } catch (e) {
      console.warn("skip tab", tab.url, e);
      continue;
    }
    if (!imgs.length) continue;
    const best = imgs.reduce((a, b) => (b.area > a.area ? b : a), imgs[0]);
    try {
      const id = await downloadWithName(best.url, makeFilename(folder, best.url, counter++));
      if (firstDownloadId === null) firstDownloadId = id;
    } catch (e) {
      console.error(e);
    }
  }
  if (firstDownloadId !== null) {
    try {
      chrome.downloads.show(firstDownloadId);
    } catch (e) {
      console.warn("show download", e);
    }
  }
}

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: "change-folder",
    title: "Change folder",
    contexts: ["action"],
  });
});

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId === "change-folder" && tab?.id) {
    await setFolder(tab.id);
  }
});

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  (async () => {
    if (msg?.type === "download") {
      await downloadAll();
      sendResponse({ ok: true });
      return;
    }
    if (msg?.type === "download-largest") {
      await downloadLargestPerTab();
      sendResponse({ ok: true });
      return;
    }
    if (msg?.type === "set-folder") {
      const folder = await setFolder(sender.tab?.id);
      sendResponse({ ok: !!folder, folder: folder || null });
      return;
    }
    if (msg?.type === "get-folder") {
      const res = await chrome.storage.local.get(STORAGE_KEY);
      sendResponse({ folder: res[STORAGE_KEY] || DEFAULT_FOLDER });
    }
  })();
  return true;
});

