import type { ListingInput } from "@/lib/types";

export async function prepareImageUpload(file: File): Promise<ListingInput["images"][number]> {
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error(`Could not read ${file.name}.`));
    reader.readAsDataURL(file);
  });
  return {
    name: file.name,
    type: file.type,
    data_url: dataUrl,
  };
}
