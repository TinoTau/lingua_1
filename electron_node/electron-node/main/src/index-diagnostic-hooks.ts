/**
 * 安装进程级诊断钩子：未处理异常、unhandledRejection、exit 追踪
 */
export function installDiagnosticHooks(): void {
  process.on('uncaughtException', (err) => {
    console.error('========================================');
    console.error('[FATAL] uncaughtException:', err);
    console.error('========================================');
  });

  process.on('unhandledRejection', (reason) => {
    console.error('========================================');
    console.error('[FATAL] unhandledRejection:', reason);
    console.error('========================================');
  });

  process.on('exit', (code) => {
    console.error('========================================');
    console.error('[TRACE] process.exit called, code =', code);
    console.error('========================================');
  });

  const realExit = process.exit;
  (process as any).exit = function (code?: number) {
    console.error('========================================');
    console.error('[TRACE] process.exit invoked with code =', code);
    console.trace();
    console.error('========================================');
    return realExit.apply(process, [code]);
  };
  console.log('✅ Diagnostic hooks installed');
}
