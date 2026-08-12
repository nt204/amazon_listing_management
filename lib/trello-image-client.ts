export async function downloadOriginalTrelloImage(input: {
  url: string;
  name: string;
  apiKey: string;
  token: string;
}) {
  const response = await fetch("/api/trello/download-image", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!response.ok) {
    const payload = (await response.json().catch(() => null)) as { error?: string } | null;
    throw new Error(payload?.error || "Không thể tải ảnh gốc.");
  }
  const blobUrl = URL.createObjectURL(await response.blob());
  try {
    const anchor = document.createElement("a");
    anchor.href = blobUrl;
    anchor.download = input.name;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
  } finally {
    window.setTimeout(() => URL.revokeObjectURL(blobUrl), 1_000);
  }
}
