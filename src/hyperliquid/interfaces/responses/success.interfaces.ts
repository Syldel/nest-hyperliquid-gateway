export interface HLSuccessResponse<T = any> {
  status: 'ok';
  response: T;
}
