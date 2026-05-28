import { HttpException, HttpStatus } from '@nestjs/common';

export interface HyperliquidErrorResponse {
  statusCode: number;
  error: string;
  message: string;
}

export class HyperliquidGatewayException extends HttpException {
  constructor(
    errorCode: string,
    message: string,
    statusCode: HttpStatus = HttpStatus.BAD_REQUEST,
  ) {
    super(
      {
        statusCode,
        error: errorCode,
        message,
      },
      statusCode,
    );
  }
}
