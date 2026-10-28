// The service worker cannot build a blob URL. It sends the finished file with
// a window message, because chrome.runtime messaging drops binary data.
type DownloadReply = { ok: true; url: string } | { ok: false; error: string };

const pending = new Set<string>();

function revokeLater(url: string): void {
  pending.add(url);
  setTimeout(() => {
    pending.delete(url);
    URL.revokeObjectURL(url);
  }, 180_000);
}

function reply(port: MessagePort, message: DownloadReply): void {
  port.postMessage(message);
}

navigator.serviceWorker.onmessage = (event: MessageEvent<Blob>) => {
  const port = event.ports[0];
  if (!port) return;
  if (!(event.data instanceof Blob)) {
    reply(port, { ok: false, error: "The video file could not be prepared for download." });
    return;
  }
  const url = URL.createObjectURL(event.data);
  revokeLater(url);
  reply(port, { ok: true, url });
};

navigator.serviceWorker.startMessages();
