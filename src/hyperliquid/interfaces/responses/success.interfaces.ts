export interface HLSuccessResponse<T = any> {
  status: 'ok';
  response: T;
}

export type HLCancelStatus =
  | 'success'
  | {
      error: string;
    };

export interface HLCancelResponse {
  status: 'ok';
  response: {
    type: 'cancel';
    data: {
      statuses: HLCancelStatus[];
    };
  };
}
