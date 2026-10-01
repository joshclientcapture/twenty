import createDOMPurify from 'dompurify';
import { convert, HtmlToTextOptions } from 'html-to-text';
import { JSDOM } from 'jsdom';
import * as planer from 'planer';
import { isNonEmptyString } from '@sniptt/guards';

import { normalizeMessageText } from 'src/modules/messaging/message-import-manager/utils/normalize-message-text.util';

const CONVERT_OPTIONS = {
  wordwrap: false,
  preserveNewlines: true,
} satisfies HtmlToTextOptions;

// Conversifi: documents created inside a jsdom window are never released while the window lives,
// so a shared converter grew the worker's heap by about 1 GB an hour of email DOM nodes. The
// window is closed and rebuilt every so often; the cost is a few milliseconds per cycle.
const RECYCLE_WINDOW_AFTER_USES = 50;

export const createHtmlToTextConverter = (): ((html: string) => string) => {
  let jsdom = new JSDOM('');
  let purify = createDOMPurify(jsdom.window);
  let uses = 0;

  return (html: string): string => {
    if (uses >= RECYCLE_WINDOW_AFTER_USES) {
      jsdom.window.close();
      jsdom = new JSDOM('');
      purify = createDOMPurify(jsdom.window);
      uses = 0;
    }
    uses++;

    const sanitizedHtml = purify.sanitize(html);

    const cleanedHtml = planer.extractFromHtml(
      sanitizedHtml,
      jsdom.window.document,
    );

    const text = normalizeMessageText(convert(cleanedHtml, CONVERT_OPTIONS));

    // planer can strip an entirely-quoted (e.g. forwarded) body to nothing;
    // fall back to the un-stripped sanitized html so the body is not lost.
    return isNonEmptyString(text)
      ? text
      : normalizeMessageText(convert(sanitizedHtml, CONVERT_OPTIONS));
  };
};
