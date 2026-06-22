import { NestFactory } from '@nestjs/core';
import { LOG_LEVELS, Logger, LogLevel, ValidationPipe } from '@nestjs/common';

import { AppModule } from './app.module';
import { ValidationExceptionFilter } from './filters/validation-exception.filter';

async function bootstrap() {
  const logger = new Logger('bootstrap');

  const isProduction = process.env.NODE_ENV === 'production';

  const app = await NestFactory.create(AppModule, { logger });

  /* ********************************************** */

  // INFO: Avec origin: '*', il faut normalement mettre => credentials: false
  const allowedOrigins: string[] = isProduction
    ? (process.env.ALLOWED_ORIGINS?.split(',').map((o) => o.trim()) ?? [])
    : ['http://localhost:3000', 'http://localhost:3001'];

  app.enableCors({
    origin: (
      requestOrigin: string | undefined,
      callback: (err: Error | null, allow?: boolean) => void,
    ): void => {
      // curl, Postman, health checks, etc.
      if (!requestOrigin) {
        callback(null, true);
        return;
      }

      const isAllowed = allowedOrigins.includes(requestOrigin);
      if (!isAllowed) {
        logger.debug(
          `Origin "${requestOrigin}" ${isAllowed ? 'allowed' : 'rejected'}`,
        );
      }

      callback(null, isAllowed);
    },
    methods: 'GET,HEAD,PUT,PATCH,POST,DELETE',
    credentials: true,
  });

  /* ********************************************** */
  app.useGlobalPipes(
    new ValidationPipe({
      transform: true,
      whitelist: true,
      forbidNonWhitelisted: true,
    }),
  );

  app.useGlobalFilters(new ValidationExceptionFilter());

  /* ********************************************** */

  // Ex: LOG_LEVELS=error,warn,log,debug
  const envLogLevels = process.env.LOG_LEVELS;

  const defaultLevels: LogLevel[] = isProduction
    ? ['error', 'warn']
    : ['log', 'debug', 'warn', 'error', 'verbose'];

  const levels: LogLevel[] = envLogLevels
    ? envLogLevels
        .split(',')
        .map((item) => item.trim().toLowerCase() as LogLevel)
        .filter((level) => LOG_LEVELS.includes(level))
    : defaultLevels;

  app.useLogger(levels.length > 0 ? levels : defaultLevels);

  /* ********************************************** */

  const port = process.env.PORT ?? 3000;
  await app.listen(port, '0.0.0.0');

  logger.warn(`\uf427  App running on port ${port} (internal)`);
}
void bootstrap().catch((err) => {
  console.error('Bootstrap failed', err);
  process.exit(1);
});
