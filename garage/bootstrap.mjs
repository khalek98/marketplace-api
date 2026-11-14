// Runs inside the Garage container after the server process is up.
// Layout, the fixed access key, and the bucket must exist before Docker
// marks the service healthy — `compose up --wait` is the only step the
// grading block runs.

const token = process.env.GARAGE_ADMIN_TOKEN;
const accessKeyId = process.env.GARAGE_ACCESS_KEY_ID;
const secretAccessKey = process.env.GARAGE_SECRET_ACCESS_KEY;
const bucketName = process.env.GARAGE_BUCKET;
const adminUrl = "http://127.0.0.1:3903";

function assertKeyShape() {
  const idOk = /^GK[0-9a-fA-F]{24}$/.test(accessKeyId ?? "");
  const secretOk = /^[0-9a-fA-F]{64}$/.test(secretAccessKey ?? "");
  if (!token || !bucketName || !idOk || !secretOk) {
    throw new Error("GARAGE_ACCESS_KEY_ID must be GK + 24 hex chars and GARAGE_SECRET_ACCESS_KEY must be 64 hex chars");
  }
}

async function sleep(ms) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function api(method, path, body) {
  const response = await fetch(`${adminUrl}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      "content-type": "application/json",
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  let payload = null;
  if (text) {
    try {
      payload = JSON.parse(text);
    } catch {
      payload = text;
    }
  }
  if (!response.ok) {
    const error = new Error(`${method} ${path} -> ${response.status} ${text}`);
    error.status = response.status;
    throw error;
  }
  return payload;
}

function unwrap(payload) {
  return Array.isArray(payload) ? payload[0] : payload;
}

async function waitForAdmin() {
  let last;
  for (let attempt = 1; attempt <= 60; attempt += 1) {
    try {
      return await api("GET", "/v2/GetClusterStatus");
    } catch (error) {
      last = error;
      await sleep(500);
    }
  }
  throw last;
}

async function ensureLayout(status) {
  const layout = await api("GET", "/v2/GetClusterLayout");
  if (layout.roles.length > 0) {
    console.log("layout already applied");
    return;
  }

  const node = status.nodes.find((item) => item.isUp) ?? status.nodes[0];
  if (!node?.id) throw new Error("garage status listed no node id");

  if (layout.stagedRoleChanges.length === 0) {
    await api("POST", "/v2/UpdateClusterLayout", {
      roles: [{ id: node.id, zone: "hw26", tags: [], capacity: 1024 ** 3 }],
    });
    console.log(`staged layout role for ${node.id}`);
  }

  const staged = await api("GET", "/v2/GetClusterLayout");
  await api("POST", "/v2/ApplyClusterLayout", { version: staged.version + 1 });
  console.log(`applied layout version ${staged.version + 1}`);
}

async function waitUntilLayoutReady() {
  let last;
  for (let attempt = 1; attempt <= 60; attempt += 1) {
    try {
      await api("GET", "/v2/ListBuckets");
      console.log(`layout ready (attempt ${attempt})`);
      return;
    } catch (error) {
      last = error;
      await sleep(500);
    }
  }
  throw last;
}

async function ensureKey() {
  try {
    await api("POST", "/v2/ImportKey", {
      name: "hw26",
      accessKeyId,
      secretAccessKey,
    });
    console.log(`imported key ${accessKeyId}`);
  } catch (error) {
    if (!/already exists/i.test(String(error.message))) throw error;
    console.log(`key ${accessKeyId} already imported`);
  }
}

async function ensureBucket() {
  const listed = await api("GET", "/v2/ListBuckets");
  const existing = (Array.isArray(listed) ? listed : []).find((bucket) =>
    (bucket.globalAliases ?? []).includes(bucketName),
  );
  if (existing) {
    console.log(`bucket ${bucketName} already exists`);
    return existing.id;
  }

  const created = unwrap(await api("POST", "/v2/CreateBucket", { globalAlias: bucketName }));
  if (created.websiteAccess) {
    throw new Error(`bucket ${bucketName} has website access; anonymous reads must stay closed`);
  }
  console.log(`created private bucket ${bucketName}`);
  return created.id;
}

async function allowKey(bucketId) {
  await api("POST", "/v2/AllowBucketKey", {
    bucketId,
    accessKeyId,
    permissions: { read: true, write: true, owner: true },
  });
  console.log(`key can read and write ${bucketName}`);
}

assertKeyShape();
const status = await waitForAdmin();
await ensureLayout(status);
await waitUntilLayoutReady();
await ensureKey();
const bucketId = await ensureBucket();
await allowKey(bucketId);
