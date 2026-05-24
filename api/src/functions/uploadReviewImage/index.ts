// ── uploadReviewImage function ────────────────────────────────────────────────
//
// POST /api/upload-review-image
//
// Accepts a multipart/form-data request with:
//   image     (File)    – required; the review photo
//   reviewId  (string)  – optional; used as a blob path prefix for grouping
//
// Processing steps:
//   1. Validate file type (jpeg / png / webp / gif) and size (≤ 8 MB).
//   2. Upload the original image to the "review-images" Blob container via the
//      shared uploadReviewImageBlob helper (Phase 1).
//   3. Derive a sibling "thumbs/" path for the 128-px thumbnail.
//   4. Enqueue a JSON job message (base64) to the thumbnail-processing queue so
//      a separate worker function can generate the thumbnail asynchronously.
//   5. Return both URLs immediately; the frontend stores imageUrl now and polls
//      (or trusts) thumbnailUrl once the worker has run.
//
// Response shape:
//   { data: { imageUrl: string, thumbnailUrl: string } }

import {
  app,
  HttpRequest,
  HttpResponseInit,
  InvocationContext,
} from '@azure/functions';
import { QueueServiceClient, QueueClient } from '@azure/storage-queue';

import {
  uploadReviewImageBlob,
  getReviewThumbnailsContainerClient,
} from '../../shared/blobClient';
import { trackException, trackEvent } from '../../shared/telemetry';

// ── Constants ─────────────────────────────────────────────────────────────────

/** Maximum accepted file size: 8 MB. Review images can be full-resolution photos. */
const MAX_BYTES = 8 * 1024 * 1024;

/**
 * MIME types allowed for review images.
 * Must be a subset of ALLOWED_CONTENT_TYPES in blobClient.ts to avoid a
 * rejection from uploadReviewImageBlob after we have already parsed the body.
 */
const ALLOWED_TYPES = new Set<string>([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
]);

/** Thumbnail longest-edge size in pixels; keeps icons crisp at 64-px density. */
const THUMBNAIL_SIZE_PX = 128;

// ── Queue client (lazy singleton) ─────────────────────────────────────────────
// Reuse the same storage connection string as Blob Storage; queue and blob share
// one account in both Azurite (local) and the real Azure environment.

let _queueClient: QueueClient | null = null;

async function getThumbnailQueueClient(): Promise<QueueClient> {
  if (_queueClient) return _queueClient;

  const connStr = process.env['BLOB_CONNECTION_STRING'];
  if (!connStr) {
    throw new Error(
      '[uploadReviewImage] Missing required environment variable "BLOB_CONNECTION_STRING". ' +
        'Check api/local.settings.json (local) or Application Settings (Azure).',
    );
  }

  const queueName =
    process.env['REVIEW_IMAGES_QUEUE_NAME'] ?? 'review-image-processing';

  const serviceClient = QueueServiceClient.fromConnectionString(connStr);
  const client = serviceClient.getQueueClient(queueName);

  // createIfNotExists is idempotent; safe to call on every cold start.
  await client.createIfNotExists();

  _queueClient = client;
  return _queueClient;
}

// ── Queue message shape ───────────────────────────────────────────────────────

/**
 * JSON payload placed on the thumbnail queue.
 * The consumer (generateThumbnail) reads blobName from the review-images
 * container, generates a thumbnail, and writes it to review-thumbnails at
 * the same blobName path — matching the thumbnailUrl returned to the caller.
 */
interface ThumbnailJobMessage {
  /** Path inside the review-images container, e.g. "revId/uuid.jpg". */
  blobName: string;
  /** MIME type of the original; forwarded so the worker can log it. */
  contentType: string;
}

// ── Handler ───────────────────────────────────────────────────────────────────

export async function uploadReviewImageHandler(
  request: HttpRequest,
  context: InvocationContext,
): Promise<HttpResponseInit> {
  context.log(
    `Upload review image – method=${request.method} url=${request.url}`,
  );

  try {
    // ── Step 1: Parse multipart form data ───────────────────────────────────
    let formData: FormData;
    try {
      formData = await request.formData();
    } catch (parseErr: unknown) {
      context.error('Failed to parse multipart form data.', parseErr);
      return {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
        jsonBody: {
          error: 'Request must be multipart/form-data with an "image" field.',
        },
      };
    }

    const entry = formData.get('image');
    if (!(entry instanceof File)) {
      return {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
        jsonBody: { error: 'Missing "image" file field in form data.' },
      };
    }

    const file = entry as File;

    // ── Step 2: Validate type and size ──────────────────────────────────────
    if (file.size === 0) {
      return {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
        jsonBody: { error: 'Uploaded file is empty.' },
      };
    }

    if (file.size > MAX_BYTES) {
      return {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
        jsonBody: {
          error: `File too large. Maximum allowed size is ${MAX_BYTES / (1024 * 1024)} MB.`,
        },
      };
    }

    const contentType = file.type || 'application/octet-stream';
    if (!ALLOWED_TYPES.has(contentType)) {
      return {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
        jsonBody: {
          error: `Unsupported image type "${contentType}". Allowed: jpeg, png, webp, gif.`,
        },
      };
    }

    // ── Step 3: Extract optional reviewId for blob path organisation ─────────
    // Callers can POST reviewId alongside the image so that originals and
    // thumbnails are grouped under "<reviewId>/" in the container.
    const reviewId =
      (formData.get('reviewId') as string | null)?.trim() || undefined;

    context.log(
      `Image validated – size=${file.size} contentType=${contentType} reviewId=${reviewId ?? 'none'}`,
    );

    // ── Step 4: Upload original to Blob Storage ──────────────────────────────
    const buffer = Buffer.from(await file.arrayBuffer());
    const { url: imageUrl, blobName: originalBlobName } =
      await uploadReviewImageBlob(buffer, contentType, reviewId);

    context.log(
      `Original blob stored – blobName=${originalBlobName} url=${imageUrl}`,
    );

    // ── Step 5: Derive thumbnail URL ─────────────────────────────────────────
    // The thumbnail worker writes its output to the review-thumbnails container
    // at the same blob path (no thumbs/ prefix needed — separate container).
    // We derive the URL now so it can be stored on the review immediately.
    const thumbnailContainer = await getReviewThumbnailsContainerClient();
    const thumbnailUrl = `${thumbnailContainer.url}/${originalBlobName}`;

    context.log(
      `Thumbnail URL derived – blobName=${originalBlobName} url=${thumbnailUrl}`,
    );

    // ── Step 6: Enqueue thumbnail generation job ─────────────────────────────
    const job: ThumbnailJobMessage = {
      blobName: originalBlobName,
      contentType,
    };
    const messageText = Buffer.from(JSON.stringify(job)).toString('base64');

    const queueClient = await getThumbnailQueueClient();
    await queueClient.sendMessage(messageText);

    context.log(
      `Thumbnail job enqueued – queue=${queueClient.name} blobName=${originalBlobName}`,
    );

    // ── Step 7: Telemetry ────────────────────────────────────────────────────
    trackEvent('review.image.uploaded', {
      contentType,
      sizeBytes: String(file.size),
      reviewId: reviewId ?? '',
      originalBlobName,
    });

    // ── Step 8: Respond ──────────────────────────────────────────────────────
    // Return both URLs so the frontend can:
    //   - store imageUrl immediately on the review document
    //   - store thumbnailUrl as the expected icon URL (available once the
    //     thumbnail worker completes – typically within seconds)
    return {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
      jsonBody: {
        data: {
          imageUrl,
          thumbnailUrl,
        },
      },
    };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    context.error('Failed to upload review image.', err);
    trackException(err, { function: 'uploadReviewImage' });
    return {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
      jsonBody: { error: `Failed to upload review image: ${message}` },
    };
  }
}

// ── Registration ──────────────────────────────────────────────────────────────

app.http('uploadReviewImage', {
  methods: ['POST'],
  authLevel: 'anonymous',
  // Accessible at: POST http://localhost:7071/api/upload-review-image
  route: 'upload-review-image',
  handler: uploadReviewImageHandler,
});
