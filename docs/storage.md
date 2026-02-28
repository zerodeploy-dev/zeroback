# File Storage

Vex provides file storage backed by Cloudflare R2. The storage API is available through `ctx.storage` with different access levels depending on the function type.

## Setup

Uncomment the R2 binding in your `wrangler.toml`:

```toml
[[r2_buckets]]
binding = "VEX_STORAGE"
bucket_name = "my-vex-storage"
```

For local development, Wrangler automatically uses a local R2 simulator.

## Access Levels

| Context | Type | Can read | Can write | Can store blobs |
|---------|------|----------|-----------|-----------------|
| `query` | `StorageReader` | Yes | No | No |
| `mutation` | `StorageWriter` | Yes | Yes | No |
| `action` | `StorageActions` | Yes | Yes | Yes |

## StorageReader

Available as `ctx.storage` in queries. Read-only access to stored files.

### `storage.getUrl(storageId)`

Get a public URL for a stored file.

```ts
storage.getUrl(storageId: string): Promise<string | null>
```

| Parameter | Type | Description |
|-----------|------|-------------|
| `storageId` | `string` | The storage ID returned by `store()` or `generateUploadUrl()` |

**Returns:** A public URL string, or `null` if the file doesn't exist.

### `storage.getMetadata(storageId)`

Get metadata for a stored file.

```ts
storage.getMetadata(storageId: string): Promise<StorageMetadata | null>
```

**Returns:** A `StorageMetadata` object, or `null` if not found.

```ts
type StorageMetadata = {
  storageId: string;
  sha256: string;
  contentType: string;
  size: number;
};
```

## StorageWriter

Available as `ctx.storage` in mutations. Extends `StorageReader` with write capabilities.

### `storage.generateUploadUrl()`

Generate a pre-signed upload URL for client-side file uploads.

```ts
storage.generateUploadUrl(): Promise<string>
```

**Returns:** A URL that the client can use to upload a file via `PUT` or `POST`.

The typical workflow:
1. Client calls a mutation to get an upload URL
2. Client uploads the file directly to R2 using the URL
3. Client calls another mutation with the resulting storage ID to associate the file with a document

```ts
export const generateUploadUrl = mutation({
  args: {},
  handler: async (ctx) => {
    return await ctx.storage.generateUploadUrl();
  },
});
```

### `storage.delete(storageId)`

Delete a stored file.

```ts
storage.delete(storageId: string): Promise<void>
```

```ts
export const deleteFile = mutation({
  args: { storageId: v.string() },
  handler: async (ctx, args) => {
    await ctx.storage.delete(args.storageId);
  },
});
```

## StorageActions

Available as `ctx.storage` in actions. Extends `StorageWriter` with the ability to store blobs directly from server-side code.

### `storage.store(blob)`

Store a `Blob` directly from server-side code. Use this in actions to upload files fetched from external APIs.

```ts
storage.store(blob: Blob): Promise<string>
```

| Parameter | Type | Description |
|-----------|------|-------------|
| `blob` | `Blob` | The file data to store |

**Returns:** A storage ID string.

```ts
export const downloadAndStore = action({
  args: { url: v.string() },
  handler: async (ctx, args) => {
    const response = await fetch(args.url);
    const blob = await response.blob();
    const storageId = await ctx.storage.store(blob);
    await ctx.runMutation("files:save", { storageId, url: args.url });
    return storageId;
  },
});
```

## Full Example

### Server

```ts
// vex/files.ts
import { query, mutation, action } from "./_generated/server";
import { v } from "@vex/values";

export const generateUploadUrl = mutation({
  args: {},
  handler: async (ctx) => {
    return await ctx.storage.generateUploadUrl();
  },
});

export const saveFile = mutation({
  args: { storageId: v.string(), name: v.string() },
  handler: async (ctx, args) => {
    return await ctx.db.insert("files", {
      storageId: args.storageId,
      name: args.name,
    });
  },
});

export const getFileUrl = query({
  args: { storageId: v.string() },
  handler: async (ctx, args) => {
    return await ctx.storage.getUrl(args.storageId);
  },
});
```

### Client

```tsx
function FileUpload() {
  const generateUploadUrl = useMutation(api.files.generateUploadUrl);
  const saveFile = useMutation(api.files.saveFile);

  const handleUpload = async (file: File) => {
    // 1. Get upload URL
    const uploadUrl = await generateUploadUrl({});

    // 2. Upload file to R2
    const response = await fetch(uploadUrl, {
      method: "PUT",
      body: file,
      headers: { "Content-Type": file.type },
    });
    const { storageId } = await response.json();

    // 3. Save reference in database
    await saveFile({ storageId, name: file.name });
  };

  return <input type="file" onChange={(e) => handleUpload(e.target.files![0])} />;
}
```
