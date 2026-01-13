export type HLCancelStatus =
  | 'success'
  | {
      error: string;
    };

export interface HLCancelOrderResponse {
  type: 'cancel';
  data: {
    statuses: HLCancelStatus[];
  };
}
