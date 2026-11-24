// Barcode decoding in the browser: from a photo/image file, or live from the
// camera. Uses the native BarcodeDetector when the browser has it, otherwise
// ZXing (pure JavaScript, bundled, works offline).

import { BrowserMultiFormatReader, BarcodeFormat, DecodeHintType } from '@zxing/library';

const FORMATS = [BarcodeFormat.EAN_13, BarcodeFormat.EAN_8, BarcodeFormat.UPC_A, BarcodeFormat.UPC_E];

function zxingReader() {
  const hints = new Map();
  hints.set(DecodeHintType.POSSIBLE_FORMATS, FORMATS);
  hints.set(DecodeHintType.TRY_HARDER, true);
  return new BrowserMultiFormatReader(hints);
}

interface NativeDetector {
  detect(source: ImageBitmapSource): Promise<Array<{ rawValue: string }>>;
}

async function nativeDetector(): Promise<NativeDetector | undefined> {
  const BD = (globalThis as unknown as { BarcodeDetector?: { new (o: { formats: string[] }): NativeDetector; getSupportedFormats(): Promise<string[]> } }).BarcodeDetector;
  if (!BD) return undefined;
  try {
    const supported = await BD.getSupportedFormats();
    const want = ['ean_13', 'ean_8', 'upc_a', 'upc_e'].filter((f) => supported.includes(f));
    return want.length ? new BD({ formats: want }) : undefined;
  } catch {
    return undefined;
  }
}

/** Decode a barcode from an image file. Returns the digits, or null if none found. */
export async function decodeImageFile(file: Blob): Promise<string | null> {
  const native = await nativeDetector();
  if (native) {
    try {
      const bitmap = await createImageBitmap(file);
      const hits = await native.detect(bitmap);
      if (hits[0]?.rawValue) return hits[0].rawValue;
    } catch {
      /* fall through to ZXing */
    }
  }
  const url = URL.createObjectURL(file);
  try {
    const result = await zxingReader().decodeFromImageUrl(url);
    return result.getText();
  } catch {
    return null;
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** Start the camera in `video` and resolve with the first barcode seen. */
export function scanFromCamera(video: HTMLVideoElement): { result: Promise<string>; stop: () => void } {
  const reader = zxingReader();
  let stopped = false;
  const result = reader
    .decodeOnceFromConstraints({ video: { facingMode: 'environment' } }, video)
    .then((r) => r.getText())
    .finally(() => {
      if (!stopped) reader.reset();
    });
  return {
    result,
    stop() {
      stopped = true;
      reader.reset();
    },
  };
}
