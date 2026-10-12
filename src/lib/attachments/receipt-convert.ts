import {
  CONVERTED_JPEG_QUALITY,
  CONVERTED_MAX_SIDE,
  fitWithin,
  type JpegConverter,
} from "./receipt-file";

/**
 * Turns a picture into a JPEG through a canvas. `createImageBitmap` throws for a format the browser cannot decode (HEIC in
 * Chrome and Firefox), which the caller treats as "not supported here". The picture is drawn on white, since JPEG has no
 * transparency, and keeps the orientation the camera stored.
 */
export const convertToJpeg: JpegConverter = async (file) => {
  const bitmap = await createImageBitmap(file, {
    imageOrientation: "from-image",
  });
  try {
    const { width, height } = fitWithin(
      bitmap.width,
      bitmap.height,
      CONVERTED_MAX_SIDE,
    );
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("no canvas context");
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, width, height);
    context.drawImage(bitmap, 0, 0, width, height);
    return await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob(
        (blob) =>
          blob ? resolve(blob) : reject(new Error("canvas gave no image")),
        "image/jpeg",
        CONVERTED_JPEG_QUALITY,
      );
    });
  } finally {
    bitmap.close();
  }
};

/** The converter, or `null` in a browser that cannot decode pictures at all. */
export function browserConverter(): JpegConverter | null {
  return typeof createImageBitmap === "function" &&
    typeof document !== "undefined"
    ? convertToJpeg
    : null;
}
