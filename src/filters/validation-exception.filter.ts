import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
} from '@nestjs/common';
import { Response } from 'express';

@Catch(HttpException)
export class ValidationExceptionFilter implements ExceptionFilter {
  catch(exception: HttpException, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const status = exception.getStatus();

    if (status === 400) {
      const validationErrors = exception.getResponse() as {
        message: string[];
        error: string;
      };
      response.status(status).json({
        statusCode: status,
        message: 'Validation failed',
        errors: validationErrors.message,
      });
    } else {
      response.status(status).json(exception.getResponse());
    }
  }
}
