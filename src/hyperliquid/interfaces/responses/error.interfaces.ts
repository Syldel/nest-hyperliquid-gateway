export interface HLErrorResponse {
  status: 'error';
  message: string;
}

/**
 * Type guard pour vérifier si un objet est une HLErrorResponse.
 * @param obj Objet à vérifier.
 * @returns True si l'objet correspond à HLErrorResponse.
 */
export function isHLErrorResponse(obj: unknown): obj is HLErrorResponse {
  if (typeof obj !== 'object' || obj === null) {
    return false;
  }

  const errorObj = obj as Record<string, unknown>;
  return (
    'status' in errorObj &&
    errorObj.status === 'error' &&
    'message' in errorObj &&
    typeof errorObj.message === 'string'
  );
}
