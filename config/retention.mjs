// Enabled only in the new empty database via retention_enabled=true.
export const retentionPolicy = { contentDays:90, rawDays:7, logDays:14, batchRows:250, warningBytes:350_000_000 };
