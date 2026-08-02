export function makeError(file, line, field, code, message, raw) {
  return { file, line, field, code, message, raw };
}

export function makeWarning(file, line, field, code, message, raw) {
  return { file, line, field, code, message, raw };
}

export function buildValidationResult({ inputFiles, rows, errors, warnings, strict }) {
  const fatalCount = errors.length;
  const warningCount = warnings.length;
  const ok = fatalCount === 0 && (!strict || warningCount === 0);
  return {
    ok,
    inputFiles: inputFiles.length,
    totalRows: rows.length,
    validRows: rows.length - fatalCount,
    errorRows: fatalCount,
    warningRows: warningCount,
    errors,
    warnings,
    strict: Boolean(strict),
  };
}
