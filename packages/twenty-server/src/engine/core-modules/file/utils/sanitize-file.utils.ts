import DOMPurify from 'dompurify';
import { JSDOM } from 'jsdom';

export const sanitizeFile = ({
  file,
  ext,
  mimeType,
}: {
  file: Buffer | Uint8Array | string;
  ext: string;
  mimeType: string | undefined;
}): Buffer | Uint8Array | string => {
  if (ext === 'svg' || mimeType === 'image/svg+xml') {
    const window = new JSDOM('').window;
    const purify = DOMPurify(window);

    let fileString: string;

    if (typeof file === 'string') {
      fileString = file;
    } else if (Buffer.isBuffer(file)) {
      fileString = file.toString('utf-8');
    } else {
      fileString = Buffer.from(file).toString('utf-8');
    }

    try {
      return purify.sanitize(fileString);
    } finally {
      // Conversifi: a jsdom window is not collected until it is closed.
      window.close();
    }
  }

  return file;
};
