// Protocol Codec - Encode/Decode WebSocket frames

import { Frame } from './types.js';

export function encodeFrame(frame: Frame): string {
  return JSON.stringify(frame);
}

export function decodeFrame(data: string): Frame {
  try {
    return JSON.parse(data);
  } catch (error) {
    throw new Error(`Failed to decode frame: ${error}`);
  }
}

export function createRequest<T = any>(
  id: string,
  method: string,
  params?: T
): Frame {
  return {
    type: 'req',
    id,
    method,
    params
  };
}

export function createResponse<T = any>(
  id: string,
  payload: T,
  ok: boolean = true
): Frame {
  return {
    type: 'res',
    id,
    ok,
    payload
  };
}

export function createErrorResponse(
  id: string,
  code: string,
  message: string,
  details?: any
): Frame {
  return {
    type: 'res',
    id,
    ok: false,
    error: {
      code,
      message,
      details
    }
  };
}

export function createEvent<T = any>(
  event: string,
  payload?: T,
  seq?: number
): Frame {
  return {
    type: 'event',
    event,
    payload,
    ...(seq !== undefined && { seq })
  };
}
