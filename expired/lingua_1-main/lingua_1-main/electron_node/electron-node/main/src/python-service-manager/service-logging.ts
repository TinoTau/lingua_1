import * as fs from 'fs';

/**
 * 智能识别日志级别
 */
export function detectLogLevel(line: string, isStderr: boolean): string {
  const upperLine = line.toUpperCase();

  // 检查是否包含明确的错误标记
  if (
    upperLine.includes('[ERROR]') ||
    upperLine.includes('ERROR:') ||
    upperLine.includes('EXCEPTION:') ||
    upperLine.includes('TRACEBACK') ||
    (upperLine.includes('FAILED') && !upperLine.includes('WARNING'))
  ) {
    return '[ERROR]';
  }

  // 检查是否包含警告标记
  if (
    upperLine.includes('[WARN]') ||
    upperLine.includes('WARNING:') ||
    upperLine.includes('FUTUREWARNING') ||
    upperLine.includes('DEPRECATIONWARNING') ||
    upperLine.includes('USERWARNING')
  ) {
    return '[WARN]';
  }

  // 检查是否包含信息标记
  if (upperLine.includes('[INFO]') || upperLine.includes('INFO:')) {
    return '[INFO]';
  }

  // 检查 Flask/服务器相关的正常信息
  if (
    upperLine.includes('RUNNING ON') ||
    upperLine.includes('SERVING FLASK APP') ||
    upperLine.includes('DEBUG MODE:') ||
    upperLine.includes('PRESS CTRL+C') ||
    upperLine.includes('PRESS CTRL+C TO QUIT') ||
    upperLine.includes('THIS IS A DEVELOPMENT SERVER')
  ) {
    return '[INFO]';
  }

  // 默认：stderr 作为警告，stdout 作为信息
  return isStderr ? '[WARN]' : '[INFO]';
}

/**
 * 将缓冲区内容按行写入日志
 */
export function flushLogBuffer(
  buffer: string,
  isStderr: boolean,
  logStream: fs.WriteStream
): string {
  const lines = buffer.split(/\r?\n/);
  // 保留最后一行（可能不完整）在缓冲区
  const completeLines = lines.slice(0, -1);
  const remainingLine = lines[lines.length - 1];

  for (const line of completeLines) {
    if (line.trim()) {
      // 只记录非空行
      const timestamp = new Date().toISOString();
      const level = detectLogLevel(line, isStderr);
      const logLine = `${timestamp} ${level} ${line}\n`;
      logStream.write(logLine, 'utf8');
    }
  }

  return remainingLine;
}

/**
 * 创建日志写入流
 */
export function createLogStream(logFile: string): fs.WriteStream {
  return fs.createWriteStream(logFile, {
    flags: 'a',
    encoding: 'utf8',
  });
}

