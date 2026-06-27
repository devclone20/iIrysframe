// Flatten ordered layers onto a canvas and export a PNG blob.

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`Failed to load layer: ${src}`));
    img.src = src;
  });
}

/**
 * Draw layers in order (index 0 = bottom) onto `canvas`, top-left aligned at
 * native size. Returns the composite dimensions. Same-sized layers stack
 * pixel-perfect; differently-sized layers align to the top-left corner.
 */
export async function drawComposite(
  canvas: HTMLCanvasElement,
  layerSrcs: string[],
): Promise<{ width: number; height: number }> {
  const imgs = await Promise.all(layerSrcs.map(loadImage));
  const width = Math.max(1, ...imgs.map((i) => i.naturalWidth));
  const height = Math.max(1, ...imgs.map((i) => i.naturalHeight));
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas 2D context unavailable.");
  ctx.clearRect(0, 0, width, height);
  for (const img of imgs) ctx.drawImage(img, 0, 0);
  return { width, height };
}

export function canvasToBlob(canvas: HTMLCanvasElement, type = "image/png"): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("toBlob failed"))), type);
  });
}
