import {
  app,
  HttpRequest,
  HttpResponseInit,
  InvocationContext,
} from '@azure/functions';

import { uploadPhotoBlob } from '../../shared/blobClient';
import { trackException, trackEvent } from '../../shared/telemetry';

/** Maximum accepted file size: 5 MB */
const MAX_BYTES = 5 * 1024 * 1024;

export async function uploadPhotoHandler(
  request: HttpRequest,
  context: InvocationContext,
): Promise<HttpResponseInit> {
  context.log(`Upload photo – method=${request.method} url=${request.url}`);

  try {
    let formData: FormData;
    try {
      formData = await request.formData();
    } catch (err: unknown) {
      context.error('Failed to parse multipart form data.', err);
      return {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
        jsonBody: { error: 'Request must be multipart/form-data with a "photo" field.' },
      };
    }

    const entry = formData.get('photo');
    if (!(entry instanceof File)) {
      return {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
        jsonBody: { error: 'Missing "photo" file field in form data.' },
      };
    }

    const file = entry as File;

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
        jsonBody: { error: `File too large. Maximum size is ${MAX_BYTES / (1024 * 1024)} MB.` },
      };
    }

    const contentType = file.type || 'application/octet-stream';
    const buffer = Buffer.from(await file.arrayBuffer());

    const { url } = await uploadPhotoBlob(buffer, contentType);

    context.log(`Photo uploaded successfully – url=${url}`);

    trackEvent('photo.uploaded', { contentType });

    return {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
      jsonBody: { data: { url } },
    };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    context.error('Failed to upload photo.', err);
    trackException(err, { function: 'uploadPhoto' });
    return {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
      jsonBody: { error: `Failed to upload photo: ${message}` },
    };
  }
}

app.http('uploadPhoto', {
  methods: ['POST'],
  authLevel: 'anonymous',
  route: 'upload-photo',
  handler: uploadPhotoHandler,
});
