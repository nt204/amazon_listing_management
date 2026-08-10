import type { ListingInput } from "@/lib/types";

export async function resizeImage(file: File): Promise<ListingInput["images"][number]> {
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error(`Could not read ${file.name}.`));
    reader.readAsDataURL(file);
  });
  const image = await new Promise<HTMLImageElement>((resolve, reject) => {
    const element = new window.Image();
    element.onload = () => resolve(element);
    element.onerror = () => reject(new Error(`Could not process ${file.name}.`));
    element.src = dataUrl;
  });
  const max = 1_600;
  const ratio = Math.min(1, max / Math.max(image.width, image.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(image.width * ratio));
  canvas.height = Math.max(1, Math.round(image.height * ratio));
  const context = canvas.getContext("2d");
  if (!context) throw new Error(`Could not resize ${file.name}.`);
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.drawImage(image, 0, 0, canvas.width, canvas.height);
  // Trello mockups are commonly large PNG files. JPEG keeps the AI input clear
  // while preventing a resized image from exceeding the API's 5 MB limit.
  const outputType = "image/jpeg";
  return {
    name: file.name.replace(/\.[A-Za-z0-9]+$/, "") + ".jpg",
    type: outputType,
    data_url: canvas.toDataURL(outputType, 0.82),
  };
}
