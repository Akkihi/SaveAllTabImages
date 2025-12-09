const folderEl = document.getElementById("current-folder");
const downloadBtn = document.getElementById("download");
const downloadLargestBtn = document.getElementById("download-largest");
const changeBtn = document.getElementById("change");

const sendMessage = (type) =>
  new Promise((resolve) => chrome.runtime.sendMessage({ type }, resolve));

const setBusy = (btn, state) => {
  if (btn) btn.disabled = state;
};

const updateFolderLabel = (folder) => {
  folderEl.textContent = folder || "";
};

const loadFolder = async () => {
  const resp = await sendMessage("get-folder");
  updateFolderLabel(resp?.folder);
};

downloadBtn.addEventListener("click", async () => {
  setBusy(downloadBtn, true);
  await sendMessage("download");
  setBusy(downloadBtn, false);
});

downloadLargestBtn.addEventListener("click", async () => {
  setBusy(downloadLargestBtn, true);
  await sendMessage("download-largest");
  setBusy(downloadLargestBtn, false);
});

changeBtn.addEventListener("click", async () => {
  setBusy(changeBtn, true);
  const resp = await sendMessage("set-folder");
  if (resp?.folder) updateFolderLabel(resp.folder);
  setBusy(changeBtn, false);
});

loadFolder();

