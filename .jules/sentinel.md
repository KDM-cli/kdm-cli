## 2024-05-24 - [Critical] Path Traversal in File Cache
**Vulnerability:** Path Traversal vulnerability in FileCacheProvider due to unsanitized cache keys.
**Learning:** User input acting as filenames must always be validated to ensure it cannot escape the intended directory.
**Prevention:** Always use path.resolve and verify the resulting path starts with the intended base directory.
