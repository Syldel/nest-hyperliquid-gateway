export interface HLSuccessResponse<T = any> {
  status: 'ok';
  response: T;
}

export interface HLCancelResponse {
  status: 'ok';
  response: {
    type: 'cancel';
    data: {
      statuses: Array<{
        error?: string;
      }>;
    };
  };
}
