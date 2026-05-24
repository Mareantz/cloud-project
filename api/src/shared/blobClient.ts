// ── Blob Storage client module ────────────────────────────────────────────────
//
// Exposes two independent storage flows:
//
//   Restaurant photos (existing)
//   ─────────────────────────────
//   getPhotosContainerClient()       → ContainerClient  (lazy, cached)
//   uploadPhotoBlob(...)             → Promise<UploadPhotoResult>
//
//   Review images (new – Phase 1)
//   ──────────────────────────────
//   getReviewImagesContainerClient() → ContainerClient  (lazy, cached)
//   uploadReviewImageBlob(...)       → Promise<UploadPhotoResult>
//
// Config is read from process.env so the same code works locally (Azurite via
// UseDevelopmentStorage=true) and in Azure (real connection string).

import { BlobServiceClient, ContainerClient, BlockBlobClient } from '@azure/storage-blob';
import { randomUUID } from 'crypto';

/** Throws a descriptive error instead of passing undefined to the SDK. */
function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `[blobClient] Missing required environment variable: "${name}". ` +
        `Check api/local.settings.json (local) or Application Settings (Azure).`,
    );
  }
  return value;
}

// ── Singleton service client ───────────────────────────────────────────────────

let _serviceClient: BlobServiceClient | null = null;

function getServiceClient(): BlobServiceClient {
  if (!_serviceClient) {
    _serviceClient = BlobServiceClient.fromConnectionString(
      requireEnv('BLOB_CONNECTION_STRING'),
    );
  }
  return _serviceClient;
}

// ── Container client ──────────────────────────────────────────────────────────

let _containerClient: ContainerClient | null = null;

/**
 * Returns the photos ContainerClient, creating the container with public blob
 * access if it does not yet exist. Safe to call multiple times.
 *
 * Public blob access lets browsers load photo URLs directly without SAS tokens.
 */
export async function getPhotosContainerClient(): Promise<ContainerClient> {
  if (!_containerClient) {
    const containerName = requireEnv('BLOB_CONTAINER_NAME');
    const client = getServiceClient().getContainerClient(containerName);
    // createIfNotExists is idempotent; 'blob' access = public read on blobs only.
    await client.createIfNotExists({ access: 'blob' });
    _containerClient = client;
  }
  return _containerClient;
}

// ── Upload helper ─────────────────────────────────────────────────────────────

/** Allowed image MIME types for uploaded restaurant photos. */
const ALLOWED_CONTENT_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
]);

/** Map MIME type → file extension for blob naming. */
function extensionFromContentType(contentType: string): string {
  const map: Record<string, string> = {
    'image/jpeg': 'jpg',
    'image/png': 'png',
    'image/webp': 'webp',
    'image/gif': 'gif',
  };
  return map[contentType] ?? 'bin';
}

export interface UploadPhotoResult {
  url: string;
  blobName: string;
}

/**
 * Uploads a photo buffer to Blob Storage and returns its public URL.
 *
 * @param buffer      Raw image bytes
 * @param contentType MIME type, e.g. "image/jpeg"
 * @returns           Public URL of the stored blob
 */
export async function uploadPhotoBlob(
  buffer: Buffer,
  contentType: string,
): Promise<UploadPhotoResult> {
  if (!ALLOWED_CONTENT_TYPES.has(contentType)) {
    throw new Error(
      `Unsupported image type "${contentType}". Allowed: jpeg, png, webp, gif.`,
    );
  }

  const ext = extensionFromContentType(contentType);
  const blobName = `${randomUUID()}.${ext}`;

  const containerClient = await getPhotosContainerClient();
  const blockBlobClient: BlockBlobClient = containerClient.getBlockBlobClient(blobName);

  await blockBlobClient.uploadData(buffer, {
    blobHTTPHeaders: { blobContentType: contentType },
  });

  return { url: blockBlobClient.url, blobName };
}

// ── Review images container ────────────────────────────────────────────────────
// Separate from restaurant-photos so retention policies and access rules can
// be configured independently in Azure (e.g. lifecycle rules for originals).

let _reviewImagesContainerClient: ContainerClient | null = null;

/**
 * Returns the review-images ContainerClient, creating the container with public
 * blob access if it does not yet exist. Safe to call multiple times.
 *
 * Container name is read from REVIEW_IMAGES_CONTAINER_NAME (default: "review-images").
 */
export async function getReviewImagesContainerClient(): Promise<ContainerClient> {
  if (!_reviewImagesContainerClient) {
    // Fall back to "review-images" so local dev works without extra config.
    const containerName = process.env['REVIEW_IMAGES_CONTAINER_NAME'] ?? 'review-images';
    const client = getServiceClient().getContainerClient(containerName);
    await client.createIfNotExists({ access: 'blob' });
    _reviewImagesContainerClient = client;
  }
  return _reviewImagesContainerClient;
}

/**
 * Uploads a review image buffer to the review-images Blob container and
 * returns the public URL plus the blob name.
 *
 * The blob name is in the form `<reviewId>/<uuid>.<ext>` when a reviewId is
 * supplied, or `<uuid>.<ext>` otherwise.  Keeping originals under a reviewId
 * prefix makes it easy for the thumbnail function to find sibling files.
 *
 * @param buffer      Raw image bytes
 * @param contentType MIME type, e.g. "image/jpeg"
 * @param reviewId    Optional review document ID used as a path prefix
 * @returns           Public URL and blob name of the stored image
 */
export async function uploadReviewImageBlob(
  buffer: Buffer,
  contentType: string,
  reviewId?: string,
): Promise<UploadPhotoResult> {
  if (!ALLOWED_CONTENT_TYPES.has(contentType)) {
    throw new Error(
      `Unsupported image type "${contentType}". Allowed: jpeg, png, webp, gif.`,
    );
  }

  const ext = extensionFromContentType(contentType);
  // Prefix with reviewId so originals and thumbnails share a logical folder.
  const blobName = reviewId
    ? `${reviewId}/${randomUUID()}.${ext}`
    : `${randomUUID()}.${ext}`;

  const containerClient = await getReviewImagesContainerClient();
  const blockBlobClient: BlockBlobClient = containerClient.getBlockBlobClient(blobName);

  await blockBlobClient.uploadData(buffer, {
    blobHTTPHeaders: { blobContentType: contentType },
  });

  return { url: blockBlobClient.url, blobName };
}

// ── Review thumbnails container ────────────────────────────────────────────────
// Separate container from review-images so lifecycle/retention policies can
// differ between originals and small thumbnail derivatives.

let _reviewThumbnailsContainerClient: ContainerClient | null = null;

/**
 * Returns the review-thumbnails ContainerClient, creating it with public blob
 * access if it does not yet exist.  Safe to call multiple times.
 *
 * Container name is read from REVIEW_THUMBNAILS_CONTAINER_NAME
 * (default: "review-thumbnails").
 */
export async function getReviewThumbnailsContainerClient(): Promise<ContainerClient> {
  if (!_reviewThumbnailsContainerClient) {
    const containerName =
      process.env['REVIEW_THUMBNAILS_CONTAINER_NAME'] ?? 'review-thumbnails';
    const client = getServiceClient().getContainerClient(containerName);
    await client.createIfNotExists({ access: 'blob' });
    _reviewThumbnailsContainerClient = client;
  }
  return _reviewThumbnailsContainerClient;
}
