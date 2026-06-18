export function secretEnvKeyForFieldId(fieldId: string): string {
  const key = fieldId.replace(/[^A-Za-z0-9_]+/g, "_").replace(/^_+|_+$/g, "");
  if (!key) {
    return "SECRET";
  }

  return /^[A-Za-z_]/.test(key) ? key : `_${key}`;
}
