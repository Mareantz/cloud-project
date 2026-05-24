// ── generateThumbnail – queue-triggered Azure Function ───────────────────────
//
// Trigger : Azure Storage Queue  "review-image-processing"
//           (queue name read from REVIEW_IMAGES_QUEUE_NAME, default value used
//            consistently throughout the codebase)
//
// Purpose : Dequeue a review-image job, download the original from the
//           review-images container, produce a 128-px-wide JPEG thumbnail,
//           and write it to the review-thumbnails container at the same blob
//           path — matching the thumbnailUrl that was already returned to the
//           frontend by uploadReviewImage and stored on the review document.
//
// Blob layout
//   Source  : review-images/<blobName>         (e.g. revId/uuid.jpg)
//   Output  : review-thumbnails/<blobName>     (same path, different container)
//
// Queue message (JSON, base64-encoded by producer)
// ─────────────────────────────────────────────────────────────────────────────
//   {
//     "blobName"    : "revId/uuid.jpg",   // path in review-images container
//     "contentType" : "image/jpeg"        // optional hint for logging
//   }
//
// Error handling
//   Malformed / missing-field messages are logged and silently discarded so a
//   poison message cannot block the queue permanently.
//   All other errors are re-thrown so the Functions runtime retries the message
//   up to its configured maxDequeueCount before dead-lettering it.

import { app, InvocationContext } from '@azure/functions';
import sharp from 'sharp';

import {
  getReviewImagesContainerClient,
  getReviewThumbnailsContainerClient,
} from '../../shared/blobClient';
import { trackEvent, trackException } from '../../shared/telemetry';

// ── Constants ─────────────────────────────────────────────────────────────────

/** Target width for generated thumbnails in pixels. Height scales proportionally. */
const THUMBNAIL_WIDTH_PX = 128;

// ── Types ─────────────────────────────────────────────────────────────────────

/**
 * Shape of the JSON object placed on the review-image-processing queue.
 * Enqueued by uploadReviewImage when a review image is successfully stored.
 */
interface ThumbnailQueueMessage {
  /** Path inside the review-images container, e.g. "revId/uuid.jpg". */
  blobName: string;
  /** MIME type of the original image.  Informational; thumbnail is always JPEG. */
  contentType?: string;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Parses the raw queue item into a ThumbnailQueueMessage.
 * The Functions runtime may deliver the payload as an already-parsed object
 * (when the message is valid JSON) or as a plain string — handle both.
 * Returns null when the message cannot be parsed so the caller can discard it.
 */
function parseQueueMessage(queueItem: unknown): ThumbnailQueueMessage | null {
  try {
    if (typeof queueItem === 'string') {
      return JSON.parse(queueItem) as ThumbnailQueueMessage;
    }
    if (typeof queueItem === 'object' && queueItem !== null) {
      return queueItem as ThumbnailQueueMessage;
    }
    return null;
  } catch {
    return null;
  }
}

// ── Handler ───────────────────────────────────────────────────────────────────

export async function generateThumbnailHandler(
  queueItem: unknown,
  context: InvocationContext,
): Promise<void> {
  context.log('generateThumbnail – message received from queue');

  // ── 1. Parse & validate the queue message ──────────────────────────────────

  const message = parseQueueMessage(queueItem);

  if (!message) {
    context.error(
      'generateThumbnail – queue item could not be parsed as JSON; discarding.',
      queueItem,
    );
    trackEvent('thumbnail.skipped', { reason: 'parse_failure' });
    return;
  }

  const { blobName, contentType } = message;

  if (!blobName) {
    context.error(
      'generateThumbnail – message is missing required "blobName" field; discarding.',
      JSON.stringify(message),
    );
    trackEvent('thumbnail.skipped', { reason: 'missing_blobName' });
    return;
  }

  context.log(
    `generateThumbnail – start | blobName=${blobName} contentType=${contentType ?? 'unknown'}`,
  );

  // ── 2. Download original image from review-images ──────────────────────────

  let originalBuffer: Buffer;
  try {
    const reviewImagesContainer = await getReviewImagesContainerClient();
    const sourceBlobClient = reviewImagesContainer.getBlockBlobClient(blobName);

    context.log(`generateThumbnail – downloading original: review-images/${blobName}`);
    originalBuffer = await sourceBlobClient.downloadToBuffer();
    context.log(
      `generateThumbnail – original downloaded | bytes=${originalBuffer.length}`,
    );
  } catch (err) {
    context.error(
      `generateThumbnail – failed to download original blob "${blobName}":`,
      err,
    );
    trackException(err, { function: 'generateThumbnail', stage: 'download', blobName });
    throw err; // re-throw → runtime will retry
  }

  // ── 3. Generate thumbnail with sharp ──────────────────────────────────────
  // Output is always JPEG regardless of input format:
  //   • JPEG is universally supported in browsers.
  //   • Fixed output format keeps thumbnail MIME types predictable.
  // withoutEnlargement: true prevents upscaling images smaller than 128 px.

  let thumbnailBuffer: Buffer;
  let thumbnailSizeBytes: number;

  try {
    const result = await sharp(originalBuffer)
      .resize({ width: THUMBNAIL_WIDTH_PX, withoutEnlargement: true })
      .jpeg({ quality: 80, progressive: true })
      .toBuffer({ resolveWithObject: true });

    thumbnailBuffer = result.data;
    thumbnailSizeBytes = result.data.length;

    context.log(
      `generateThumbnail – thumbnail created | width=${result.info.width}px ` +
        `height=${result.info.height}px bytes=${thumbnailSizeBytes}`,
    );
  } catch (err) {
    context.error(
      `generateThumbnail – sharp processing failed for blob "${blobName}":`,
      err,
    );
    trackException(err, { function: 'generateThumbnail', stage: 'resize', blobName });
    throw err;
  }

  // ── 4. Upload thumbnail to review-thumbnails ───────────────────────────────
  // The thumbnail is written to the review-thumbnails container at the same
  // blobName path as the original — so the thumbnailUrl returned at upload
  // time points to exactly this blob once the worker completes.

  let thumbnailUrl: string;
  try {
    const thumbnailContainer = await getReviewThumbnailsContainerClient();
    const destBlobClient = thumbnailContainer.getBlockBlobClient(blobName);

    await destBlobClient.uploadData(thumbnailBuffer, {
      blobHTTPHeaders: { blobContentType: 'image/jpeg' },
    });

    thumbnailUrl = destBlobClient.url;
    context.log(`generateThumbnail – thumbnail uploaded | url=${thumbnailUrl}`);
  } catch (err) {
    context.error(
      `generateThumbnail – failed to upload thumbnail for blob "${blobName}":`,
      err,
    );
    trackException(err, { function: 'generateThumbnail', stage: 'upload', blobName });
    throw err;
  }

  // ── 5. Emit success telemetry ──────────────────────────────────────────────

  trackEvent('thumbnail.generated', {
    blobName,
    originalBytes: String(originalBuffer.length),
    thumbnailBytes: String(thumbnailSizeBytes),
    widthPx: String(THUMBNAIL_WIDTH_PX),
  });

  context.log(
    `generateThumbnail – complete | blobName=${blobName} ` +
      `original=${originalBuffer.length}B → thumbnail=${thumbnailSizeBytes}B`,
  );
}

// ── Registration ──────────────────────────────────────────────────────────────

app.storageQueue('generateThumbnail', {
  queueName: process.env['REVIEW_IMAGES_QUEUE_NAME'] ?? 'review-image-processing',
  connection: 'BLOB_CONNECTION_STRING',
  handler: generateThumbnailHandler,
});
